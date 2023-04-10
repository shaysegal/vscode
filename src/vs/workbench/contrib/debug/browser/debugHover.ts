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
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IMouseTarget, IMouseTargetContentText } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import * as nls from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { ILogService } from 'vs/platform/log/common/log';
import { asCssVariable, editorHoverBackground, editorHoverBorder, editorHoverForeground, textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { renderExpressionValue } from 'vs/workbench/contrib/debug/browser/baseDebugView';
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
	private sketchContent: string = nls.localize({ key: 'quickTip2', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'click to change acceptamce option ', isMacintosh ? 'Option' : 'Alt');
	private mouseTarget: IMouseTarget | undefined;
	constructor(
		private editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		this.toDispose = [];

		this._isVisible = false;
		this.showAtPosition = null;
		this.positionPreference = [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW];
		this.debugHoverComputer = this.instantiationService.createInstance(DebugHoverComputer, this.editor);
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
		disableEnableLink.textContent = nls.localize("enable", "enable");
		disableEnableLink.tabIndex = 0;
		disableEnableLink.style.color = asCssVariable(textLinkForeground);

		this.toDispose.push(dom.addStandardDisposableListener(disableEnableLink, 'click', (e: IKeyboardEvent) => {
			if (e.target.textContent === 'enable') {
				disableEnableLink.textContent = nls.localize("disable", "disable");
			} else {
				disableEnableLink.textContent = nls.localize("enable", "enable");
			}
		}));



		//tip.textContent = nls.localize({ key: 'quickTip', comment: ['"switch to editor language hover" means to show the programming language hover widget instead of the debug hover'] }, 'Hold {0} key to switch to editor language hover', isMacintosh ? 'Option' : 'Alt');
		const dataSource = new DebugHoverDataSource();
		const linkeDetector = this.instantiationService.createInstance(LinkDetector);
		this.tree = <WorkbenchAsyncDataTree<IExpression, IExpression, any>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'DebugHover', this.treeContainer, new DebugHoverDelegate(), [this.instantiationService.createInstance(VariablesRenderer, linkeDetector)],
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
			if (e.element && e.element.name === '??') {
				const session = this.debugService.getViewModel().focusedSession;
				if (session && e.element instanceof Variable && session.capabilities.supportsSetVariable && !e.element.presentationHint?.attributes?.includes('readOnly') && !e.element.presentationHint?.lazy) {
					this.debugService.getViewModel().setSelectedExpression(e.element, false);
				}
			}
		}
		));
		this.toDispose.push(this.editor.onMouseMove((e) => {
			this.mouseTarget = e.target;
		}));
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

		await this.tree.setInput(expression);
		try {
			this.complexValueTitle.textContent = (expression as Expression).inDesynt && !((this.mouseTarget as IMouseTargetContentText).detail?.mightBeForeignElement) ? '??' : expression.value;
		} catch {
			this.complexValueTitle.textContent = expression.value;
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

	async evaluate(session: IDebugSession): Promise<IExpression | undefined> {
		if (!this._currentExpression) {
			this.logService.error('No expression to evaluate');
			return;
		}
		let isDesynt = false;
		if (this._currentExpression === '??') {
			this._currentExpression = `synt_dict[${this._currentRange!.startLineNumber}]`;
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
