/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { coalesce } from 'vs/base/common/arrays';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { KeyCode } from 'vs/base/common/keyCodes';
import * as lifecycle from 'vs/base/common/lifecycle';
import { isMacintosh } from 'vs/base/common/platform';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IMouseTarget } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import * as nls from 'vs/nls';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { asCssVariable, editorHoverBackground, editorHoverBorder, editorHoverForeground, textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { IInputBoxOptions, renderExpressionValue } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { VariablesRenderer } from 'vs/workbench/contrib/debug/browser/variablesView';
import { IDebugService, IDebugSession, IExpression, IExpressionContainer, IStackFrame } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable } from 'vs/workbench/contrib/debug/common/debugModel';
import { getEvaluatableExpressionAtPosition } from 'vs/workbench/contrib/debug/common/debugUtils';

const $ = dom.$;

async function doFindExpression(container: IExpressionContainer, namesToFind: string[]): Promise<IExpression | null> {
	if (!container) {
		return null;
	}

	const children = await container.getChildren();
	// look for our variable in the list. First find the parents of the hovered variable if there are any.
	const filtered = children.filter(v => namesToFind[0] === v.name);
	if (filtered.length !== 1) {
		return null;
	}

	if (namesToFind.length === 1) {
		return filtered[0];
	} else {
		return doFindExpression(filtered[0], namesToFind.slice(1));
	}
}

export async function findExpressionInStackFrame(stackFrame: IStackFrame, namesToFind: string[]): Promise<IExpression | undefined> {
	const scopes = await stackFrame.getScopes();
	const nonExpensive = scopes.filter(s => !s.expensive);
	const expressions = coalesce(await Promise.all(nonExpensive.map(scope => doFindExpression(scope, namesToFind))));

	// only show if all expressions found have the same value
	return expressions.length > 0 && expressions.every(e => e.value === expressions[0].value) ? expressions[0] : undefined;
}

export class DebugHoverWidget implements IContentWidget {

	static readonly ID = 'debug.hoverWidget';
	// editor.IContentWidget.allowEditorOverflow
	readonly allowEditorOverflow = true;

	private _isVisible: boolean;
	private showCancellationSource?: CancellationTokenSource;
	private domNode!: HTMLElement;
	private tree!: AsyncDataTree<IExpression, IExpression, any>;
	private showAtPosition: Position | null;
	private positionPreference: ContentWidgetPositionPreference[];
	private readonly highlightDecorations = this.editor.createDecorationsCollection();
	private complexValueContainer!: HTMLElement;
	private complexValueTitle!: HTMLElement;
	private valueContainer!: HTMLElement;
	private treeContainer!: HTMLElement;
	private toDispose: lifecycle.IDisposable[];
	private scrollbar!: DomScrollableElement;
	private debugHoverComputer: DebugHoverComputer;
	private normalContent: string = nls.localize({ key: 'quickTip', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'Hold {0} key to switch to editor language hover ', isMacintosh ? 'Option' : 'Alt');
	private sketchContent: string = nls.localize({ key: 'quickTip2', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'click to change acceptance option ', isMacintosh ? 'Option' : 'Alt');
	private mouseTarget: IMouseTarget | undefined;
	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		this.toDispose = [];

		this._isVisible = false;
		this.showAtPosition = null;
		this.positionPreference = [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW];
		this.debugHoverComputer = this.instantiationService.createInstance(DebugHoverComputer, this.editor);
		this.toDispose.push(this.editor.onMouseMove((e) => {
			this.mouseTarget = e.target;
		}));
	}

	private create(): void {
		this.domNode = $('.debug-hover-widget');
		this.complexValueContainer = dom.append(this.domNode, $('.complex-value'));
		this.complexValueTitle = dom.append(this.complexValueContainer, $('.title'));
		this.treeContainer = dom.append(this.complexValueContainer, $('.debug-hover-tree'));
		this.treeContainer.setAttribute('role', 'tree');
		const tip = dom.append(this.complexValueContainer, $('.tip'));
		tip.textContent = this.normalContent;
		const disableEnableLink = dom.append(tip, $('a'));
		disableEnableLink.setAttribute('target', '_blank');
		disableEnableLink.setAttribute('href', 'disableEnableLink');
		disableEnableLink.textContent = nls.localize("disable", "disable");
		disableEnableLink.tabIndex = 0;
		disableEnableLink.style.color = asCssVariable(textLinkForeground);

		this.toDispose.push(dom.addStandardDisposableListener(disableEnableLink, 'click', (e: IKeyboardEvent) => {
			const bp = this.debugService.getModel().getBreakpoints({ lineNumber: this.showAtPosition?.lineNumber });
			if (e.target.textContent === 'enable') {
				this.debugService.enableOrDisableBreakpoints(true, bp[0]);
				disableEnableLink.textContent = nls.localize("disable", "disable");
			} else {
				this.debugService.enableOrDisableBreakpoints(false, bp[0]);
				disableEnableLink.textContent = nls.localize("enable", "enable");
			}
		}));



		//tip.textContent = nls.localize({ key: 'quickTip', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'Hold {0} key to switch to editor language hover', isMacintosh ? 'Option' : 'Alt');
		const dataSource = new DebugHoverDataSource();
		const linkeDetector = this.instantiationService.createInstance(LinkDetector);
		this.tree = <WorkbenchAsyncDataTree<IExpression, IExpression, any>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'DebugHover', this.treeContainer, new DebugHoverDelegate(), [this.instantiationService.createInstance(HoverVariablesRenderer, linkeDetector)],
			dataSource, {
			accessibilityProvider: new DebugHoverAccessibilityProvider(),
			mouseSupport: true,
			horizontalScrolling: true,
			useShadows: false,
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IExpression) => e.name },
			overrideStyles: {
				listBackground: editorHoverBackground
			}
		});
		this.toDispose.push(this.tree.onMouseDblClick((e) => {
			if (e.element && e.element.name === 'sketchValue') {
				const session = this.debugService.getViewModel().focusedSession;
				if (session && e.element instanceof Variable && session.capabilities.supportsSetVariable && !e.element.presentationHint?.attributes?.includes('readOnly') && !e.element.presentationHint?.lazy) {
					this.debugService.getViewModel().setSelectedExpression(e.element, false);
				}
			} else if (e.element && e.element.name.replaceAll('\'', '') === 'overrideValue') {
				const session = this.debugService.getViewModel().focusedSession;
				if (session && e.element instanceof Variable && session.capabilities.supportsSetVariable && !e.element.presentationHint?.attributes?.includes('readOnly') && !e.element.presentationHint?.lazy) {
					this.debugService.getViewModel().setSelectedExpression(e.element, false);
				}
			}
		}
		));
		const findElementByText = function (parentElement: any, searchText: string) {
			const elements = parentElement.getElementsByTagName('*');

			for (let i = 0; i < elements.length; i++) {
				const element = elements[i];

				if (element.textContent.match('^' + searchText + '.')) {
					return element;
				}

				const innerElement: any = findElementByText(element, searchText);
				if (innerElement) {
					return innerElement;
				}
			}

			return null; // Element not found
		};
		this.toDispose.push(this.tree.onKeyDown((e) => {
			if (e.key === 'Enter') {
				if (e.currentTarget) {
					if ((e.currentTarget as any).innerText.includes('sketchValue') || (e.currentTarget as any).innerText.includes('overrideValue')) {
						const doubleClickEvent = new Event('dblclick', {
							bubbles: true,
							cancelable: true
						});
						const sketchvalElement = findElementByText(e.currentTarget, '(sketchValue:|\'overrideValue\':)');
						if (sketchvalElement) {
							sketchvalElement.dispatchEvent(doubleClickEvent);
						}
						//(e.currentTarget as any).children[0].children[0].children[2].dispatchEvent(doubleClickEvent);
					}
				}
			}
		}
		));


		this.toDispose.push(this.debugService.getViewModel().onDidSelectExpression(e => {
			const variable = e?.expression;
			if (variable instanceof Variable && !e?.settingWatch) {
				const horizontalScrolling = this.tree.options.horizontalScrolling;
				if (horizontalScrolling) {
					this.tree.updateOptions({ horizontalScrolling: false });
				}
				this.tree.rerender(variable);
			}
		}));
		this.toDispose.push(this.debugService.getViewModel().onWillUpdateViews(() => {
			this.tree.updateChildren();
		}));


		this.valueContainer = $('.value');
		this.valueContainer.tabIndex = 0;
		this.valueContainer.setAttribute('role', 'tooltip');
		this.scrollbar = new DomScrollableElement(this.valueContainer, { horizontal: ScrollbarVisibility.Hidden });
		this.domNode.appendChild(this.scrollbar.getDomNode());
		this.toDispose.push(this.scrollbar);

		this.editor.applyFontInfo(this.domNode);
		this.domNode.style.backgroundColor = asCssVariable(editorHoverBackground);
		this.domNode.style.border = `1px solid ${asCssVariable(editorHoverBorder)}`;
		this.domNode.style.color = asCssVariable(editorHoverForeground);

		this.toDispose.push(this.tree.onDidChangeContentHeight(() => this.layoutTreeAndContainer(false)));

		this.registerListeners();
		this.editor.addContentWidget(this);
	}

	private registerListeners(): void {
		this.toDispose.push(dom.addStandardDisposableListener(this.domNode, 'keydown', (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			}
		}));
		this.toDispose.push(this.editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this.editor.applyFontInfo(this.domNode);
			}
		}));

		this.toDispose.push(this.debugService.getViewModel().onDidEvaluateLazyExpression(async e => {
			if (e instanceof Variable && this.tree.hasNode(e)) {
				await this.tree.updateChildren(e, false, true);
				await this.tree.expand(e);
			}
		}));
	}

	isHovered(): boolean {
		return !!this.domNode?.matches(':hover');
	}

	isVisible(): boolean {
		return this._isVisible;
	}

	willBeVisible(): boolean {
		return !!this.showCancellationSource;
	}

	getId(): string {
		return DebugHoverWidget.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	async showAt(position: Position, focus: boolean): Promise<void> {
		this.showCancellationSource?.cancel();
		const cancellationSource = this.showCancellationSource = new CancellationTokenSource();
		const session = this.debugService.getViewModel().focusedSession;

		if (!session || !this.editor.hasModel()) {
			this.hide();
			return;
		}

		const result = await this.debugHoverComputer.compute(position, cancellationSource.token);
		if (this.isVisible() && !result.rangeChanged) {
			return;
		}

		if (!result.range || cancellationSource.token.isCancellationRequested) {
			this.hide();
			return;
		}

		const expression = await this.debugHoverComputer.evaluate(session);
		if (cancellationSource.token.isCancellationRequested || !expression || (expression instanceof Expression && !expression.available)) {
			this.hide();
			return;
		}

		this.highlightDecorations.set([{
			range: result.range,
			options: DebugHoverWidget._HOVER_HIGHLIGHT_DECORATION_OPTIONS
		}]);

		return this.doShow(result.range.getStartPosition(), expression, focus);
	}

	private static readonly _HOVER_HIGHLIGHT_DECORATION_OPTIONS = ModelDecorationOptions.register({
		description: 'bdebug-hover-highlight',
		className: 'hoverHighlight'
	});

	private async doShow(position: Position, expression: IExpression, focus: boolean, forceValueHover = false): Promise<void> {
		if (!this.domNode) {
			this.create();
		}
		if ((expression as Expression).inDesynt) {
			const bp = this.debugService.getModel().getBreakpoints({ lineNumber: position.lineNumber });
			if (bp.length) {
				(this.domNode.querySelector('.tip')!.lastChild! as HTMLElement).textContent = bp[0].enabled ? nls.localize("disable", "disable") : nls.localize("enable", "enable");
			}
			this.domNode.querySelector('.tip')!.firstChild!.textContent = this.sketchContent;//text
			(this.domNode.querySelector('.tip')!.lastChild! as HTMLElement).hidden = false;//href
		} else {
			this.domNode.querySelector('.tip')!.firstChild!.textContent = this.normalContent;
			(this.domNode.querySelector('.tip')!.lastChild! as HTMLElement).hidden = true;//href
		}
		this.showAtPosition = position;
		this._isVisible = true;

		if (!expression.hasChildren || forceValueHover) {
			this.complexValueContainer.hidden = true;
			this.valueContainer.hidden = false;
			renderExpressionValue(expression, this.valueContainer, {
				showChanged: false,
				colorize: true
			});
			this.valueContainer.title = '';
			this.editor.layoutContentWidget(this);
			this.scrollbar.scanDomNode();
			if (focus) {
				this.editor.render();
				this.valueContainer.focus();
			}

			return undefined;
		}

		this.valueContainer.hidden = true;
		try {
			if ((expression as Expression).inDesynt) {
				let title = 'Hole';
				const bodyExperssion = expression as Expression;
				const hasSolutionExpression = new Expression(`'solution' in ${expression.name}`);
				await hasSolutionExpression.evaluate(this.debugService.getViewModel().focusedSession, this.debugService.getViewModel().focusedStackFrame, 'hover');

				// Given removal of if solution condition in createExpressionStringForSketch, this code is no longer reached
				if (hasSolutionExpression.value === 'True') {
					const solutionExpression = new Expression(`${expression.name}['solution']`);
					await solutionExpression.evaluate(this.debugService.getViewModel().focusedSession, this.debugService.getViewModel().focusedStackFrame, 'hover');
					title = solutionExpression.value;
				} else {
					//bodyExperssion = new Expression(`sketchValueContainer`);
					await bodyExperssion.evaluate(this.debugService.getViewModel().focusedSession, this.debugService.getViewModel().focusedStackFrame, 'hover');
				}

				// if ((this.mouseTarget as IMouseTargetContentText).detail?.mightBeForeignElement) {//on decoration
				// 	console.log("diff");
				// 	bodyExperssion = new Expression(`synt_dict[${this.mouseTarget?.range?.startLineNumber}]`);
				// 	await bodyExperssion.evaluate(this.debugService.getViewModel().focusedSession, this.debugService.getViewModel().focusedStackFrame, 'hover');
				// 	this.complexValueTitle.textContent = title;//expression.value;
				// 	await this.tree.setInput(bodyExperssion);
				// } else {
				// 	this.complexValueTitle.textContent = title;//'??';
				// 	await this.tree.setInput(bodyExperssion);
				// }

				this.complexValueTitle.textContent = title;//'??';
				await this.tree.setInput(bodyExperssion);
			} else {
				this.complexValueTitle.textContent = expression.value;
				await this.tree.setInput(expression);
			}

		} catch {
			this.complexValueTitle.textContent = expression.value;
			await this.tree.setInput(expression);
		}
		this.complexValueTitle.title = expression.value;
		this.layoutTreeAndContainer(true);
		this.tree.scrollTop = 0;
		this.tree.scrollLeft = 0;
		this.complexValueContainer.hidden = false;

		if (focus) {
			this.editor.render();
			this.tree.domFocus();
		}
	}

	private layoutTreeAndContainer(initialLayout: boolean): void {
		const scrollBarHeight = 10;
		const treeHeight = Math.min(Math.max(266, this.editor.getLayoutInfo().height * 0.55), this.tree.contentHeight + scrollBarHeight);
		this.treeContainer.style.height = `${treeHeight}px`;
		this.tree.layout(treeHeight, initialLayout ? 400 : undefined);
		this.editor.layoutContentWidget(this);
		this.scrollbar.scanDomNode();
	}

	afterRender(positionPreference: ContentWidgetPositionPreference | null) {
		if (positionPreference) {
			// Remember where the editor placed you to keep position stable #109226
			this.positionPreference = [positionPreference];
		}
	}


	hide(): void {
		if (this.showCancellationSource) {
			this.showCancellationSource.cancel();
			this.showCancellationSource = undefined;
		}

		if (!this._isVisible) {
			return;
		}

		if (dom.isAncestor(document.activeElement, this.domNode)) {
			this.editor.focus();
		}
		this._isVisible = false;
		this.highlightDecorations.clear();
		this.editor.layoutContentWidget(this);
		this.positionPreference = [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW];
	}

	getPosition(): IContentWidgetPosition | null {
		return this._isVisible ? {
			position: this.showAtPosition,
			preference: this.positionPreference
		} : null;
	}

	dispose(): void {
		this.toDispose = lifecycle.dispose(this.toDispose);
	}
}

class DebugHoverAccessibilityProvider implements IListAccessibilityProvider<IExpression> {

	getWidgetAriaLabel(): string {
		return nls.localize('treeAriaLabel', "Debug Hover");
	}

	getAriaLabel(element: IExpression): string {
		return nls.localize({ key: 'variableAriaLabel', comment: ['Do not translate placeholders. Placeholders are name and value of a variable.'] }, "{0}, value {1}, variables, debug", element.name, element.value);
	}
}

class DebugHoverDataSource implements IAsyncDataSource<IExpression, IExpression> {

	hasChildren(element: IExpression): boolean {
		return element.hasChildren;
	}

	getChildren(element: IExpression): Promise<IExpression[]> {
		return element.getChildren();
	}
}

class DebugHoverDelegate implements IListVirtualDelegate<IExpression> {
	getHeight(element: IExpression): number {
		return 18;
	}

	getTemplateId(element: IExpression): string {
		return VariablesRenderer.ID;
	}
}

interface IDebugHoverComputeResult {
	rangeChanged: boolean;
	range?: Range;
}

class DebugHoverComputer {
	private _currentRange: Range | undefined;
	private _currentExpression: string | undefined;

	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly logService: ILogService,
	) { }

	public async compute(position: Position, token: CancellationToken): Promise<IDebugHoverComputeResult> {
		const session = this.debugService.getViewModel().focusedSession;
		if (!session || !this.editor.hasModel()) {
			return { rangeChanged: false };
		}

		const model = this.editor.getModel();
		const result = await getEvaluatableExpressionAtPosition(this.languageFeaturesService, model, position, token);
		if (!result) {
			return { rangeChanged: false };
		}

		const { range, matchingExpression } = result;
		const rangeChanged = this._currentRange ?
			!this._currentRange.equalsRange(range) :
			true;
		this._currentExpression = matchingExpression;
		this._currentRange = Range.lift(range);
		return { rangeChanged, range: this._currentRange };
	}
	private async createExpressionStringForSketch(lineNumber: number): Promise<string> {
		const experssion = `synt_dict[${lineNumber}]`;
		const hasSolutionExpression = new Expression(`'solution' in ${experssion}`);
		await hasSolutionExpression.evaluate(this.debugService.getViewModel().focusedSession, this.debugService.getViewModel().focusedStackFrame, 'hover');
		// if (hasSolutionExpression.value === 'True') {
		// 	return experssion;
		// }
		return `sketchValueContainer`;
	}
	async evaluate(session: IDebugSession): Promise<IExpression | undefined> {
		if (!this._currentExpression) {
			this.logService.error('No expression to evaluate');
			return;
		}
		let isDesynt = false;
		if (this._currentExpression === '??') {
			this._currentExpression = await this.createExpressionStringForSketch(this._currentRange!.startLineNumber);//`synt_dict[${this._currentRange!.startLineNumber}]`;
			isDesynt = true;
		}
		if (session.capabilities.supportsEvaluateForHovers) {
			const expression = new Expression(this._currentExpression);
			expression.inDesynt = isDesynt;
			await expression.evaluate(session, this.debugService.getViewModel().focusedStackFrame, 'hover');
			return expression;
		} else {
			const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
			if (focusedStackFrame) {
				return await findExpressionInStackFrame(
					focusedStackFrame,
					coalesce(this._currentExpression.split('.').map(word => word.trim())));
			}
		}

		return undefined;
	}
}

export class HoverVariablesRenderer extends VariablesRenderer {
	constructor(linkDetector: LinkDetector,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IDebugService debugService: IDebugService,
		@IContextViewService contextViewService: IContextViewService,
		@IStorageService private readonly storageService: IStorageService) {
		super(linkDetector, menuService, contextKeyService, debugService, contextViewService);
	}
	protected override getInputBoxOptions(expression: IExpression): IInputBoxOptions {
		const inputBoxOptions = super.getInputBoxOptions(expression);
		const oldOnFinish = inputBoxOptions.onFinish;
		inputBoxOptions.onFinish = async (value: string, success: boolean) => {

			// TODO: Need to notify if at new iteration
			// Crap solution done by adding desytniteration to storage
			this.storageService.store((this.debugService.getViewModel()?.focusedSession?.getId() ?? 'desynt') + this.storageService.desyntIteration.toString(), value, StorageScope.PROFILE, StorageTarget.MACHINE);
			oldOnFinish(value, success);

			// Update synt_dict every time the user inputs a new sketch value to allow user to synthesis with current sketch included
			// Mad ugly, but works
			const session = await this.debugService.getViewModel().focusedSession;
			const thread = await this.debugService.getViewModel().focusedThread;
			const stackFrame = await this.debugService.getViewModel().focusedStackFrame;
			const wrapperFrame = thread?.getCallStack().find(f => f.name === 'like_runpy');

			const scopes = await stackFrame?.getScopes();
			const localScope = await scopes!.
				find(s => s.name === 'Locals')?.
				getChildren()!;
			const locals = JSON.stringify(localScope.map(l => l.toString()));

			if (session && stackFrame && wrapperFrame) {
				const updateEvaluation = `update_synt_dict(${locals}, ${value}, ${stackFrame.range.startLineNumber})`;
				await session.evaluate(updateEvaluation, wrapperFrame.frameId);
			}

			// Debug continuation after the user inserts the desired value to fill hole
			// const threadToContinue = this.debugService.getViewModel().focusedThread;
			// if (!threadToContinue) {
			// 	return;
			// }
			// await threadToContinue.();
		};

		return inputBoxOptions;

	}
}
