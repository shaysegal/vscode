/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDragAndDropData } from 'vs/base/browser/dnd';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Button } from 'vs/base/browser/ui/button/button';
import { IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ElementsDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IAsyncDataSource, ITreeContextMenuEvent, ITreeDragAndDrop, ITreeDragOverReaction, ITreeMouseEvent } from 'vs/base/browser/ui/tree/tree';
import { IAction } from 'vs/base/common/actions';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Codicon } from 'vs/base/common/codicons';
import { FuzzyScore } from 'vs/base/common/filters';
import { localize } from 'vs/nls';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { Action2, IMenu, IMenuService, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { defaultButtonStyles } from 'vs/platform/theme/browser/defaultStyles';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ViewAction, ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { AbstractExpressionsRenderer, IExpressionTemplateData, IInputBoxOptions, renderExpressionValue, renderViewTree } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { SynthesisTimeoutInMiliSeconds, SynthesizerPort, SynthesizerUrl, SythesisRequestRoute } from 'vs/workbench/contrib/debug/browser/deSyntConstants';
import { watchExpressionsAdd, watchExpressionsRemoveAll } from 'vs/workbench/contrib/debug/browser/debugIcons';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { VariablesRenderer, updateForgetScopes, } from 'vs/workbench/contrib/debug/browser/variablesView';
import { CONTEXT_CAN_VIEW_MEMORY, CONTEXT_DESYNT_CANDIDATE_EXIST, CONTEXT_DESYNT_EXIST, CONTEXT_DESYNT_FOCUSED, CONTEXT_IN_DEBUG_MODE, CONTEXT_VARIABLE_IS_READONLY, CONTEXT_WATCH_ITEM_TYPE, DESYNT_VIEW_ID, IDebugService, IDebugSession, IExpression, IStackFrame } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable } from 'vs/workbench/contrib/debug/common/debugModel';
// import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';

import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IProgressService } from 'vs/platform/progress/common/progress';



const MAX_VALUE_RENDER_LENGTH_IN_VIEWLET = 1024;
let ignoreViewUpdates = false;
let useCachedEvaluation = false;

export class DeSyntView extends ViewPane {

	private watchExpressionsUpdatedScheduler: RunOnceScheduler;
	private needsRefresh = false;
	private tree!: WorkbenchAsyncDataTree<IDebugService | IExpression, IExpression, FuzzyScore>;
	private watchExpressionsExist: IContextKey<boolean>;
	private candidateExist: IContextKey<boolean>;
	private watchItemType: IContextKey<string | undefined>;
	private variableReadonly: IContextKey<boolean>;
	private menu: IMenu;
	private notificationSer: INotificationService;
	progressSer: IProgressService;
	// private editorService: ICodeEditorService;
	solution: boolean;
	constructor(
		options: IViewletViewOptions,
		// @ICodeEditorService editorService: ICodeEditorService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IMenuService menuService: IMenuService,
		@INotificationService notificationService: INotificationService,
		@IProgressService progressService: IProgressService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.solution = false;
		this.notificationSer = notificationService;
		this.progressSer = progressService;
		this.menu = menuService.createMenu(MenuId.DebugWatchContext, contextKeyService);
		this._register(this.menu);
		this.watchExpressionsUpdatedScheduler = new RunOnceScheduler(() => {
			this.needsRefresh = false;
			this.tree.updateChildren();
		}, 50);

		// this.editorService = editorService;
		this.watchExpressionsExist = CONTEXT_DESYNT_EXIST.bindTo(contextKeyService);
		this.candidateExist = CONTEXT_DESYNT_CANDIDATE_EXIST.bindTo(contextKeyService);
		this.variableReadonly = CONTEXT_VARIABLE_IS_READONLY.bindTo(contextKeyService);
		this.watchExpressionsExist.set(this.debugService.getModel().getWatchExpressions(true).length > 0);
		this.watchItemType = CONTEXT_WATCH_ITEM_TYPE.bindTo(contextKeyService);

	}
	private async ad_hoc_alter_val(session: IDebugSession, stackFrame: IStackFrame): Promise<DebugProtocol.EvaluateResponse | undefined> {

		const evaluation = `ad_hoc_alter__a__("${stackFrame.name}")`;
		const evaluationResult = await session.evaluate(evaluation, stackFrame.frameId);
		if (evaluationResult) {
			console.log(evaluationResult);
			return evaluationResult;
		}
		return undefined;
	}
	async synthesize(SyntDictJson: Object, session: IDebugSession, stackFrame: IStackFrame, controller: AbortController) {
		if (Object.keys(SyntDictJson).length === 0) {//empty object
			await this.ad_hoc_alter_val(session, stackFrame);
			const syntDictEvaluation = '__import__(\'json\').dumps(synt_dict,cls=MyEncoder)';
			const newSyntDict = await session.evaluate(syntDictEvaluation, stackFrame.frameId);
			SyntDictJson = JSON.parse(newSyntDict!.body.result.replaceAll('\'', '').replaceAll(/\bNaN\b/g, '"NaN"'));
		}

		const updateEvaluation = `remove_sol_if_override(${stackFrame.range.startLineNumber})`;
		await session.evaluate(updateEvaluation, stackFrame.frameId);
		await this.sendToSynthesizer(SyntDictJson, controller);
		return;
	}
	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.element.classList.add('debug-pane');
		container.classList.add('debug-watch');

		const treeContainer = renderViewTree(container);

		const expressionsRenderer = this.instantiationService.createInstance(WatchExpressionsRenderer);
		const linkeDetector = this.instantiationService.createInstance(LinkDetector);
		const buttonLabel = localize('Synthesize', 'Synthesize');
		const button = this._register(new Button(treeContainer, { title: buttonLabel, ...defaultButtonStyles }));
		this.tree = <WorkbenchAsyncDataTree<IDebugService | IExpression, IExpression, FuzzyScore>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'WatchExpressions', treeContainer, new WatchExpressionsDelegate(), [expressionsRenderer, this.instantiationService.createInstance(VariablesRenderer, linkeDetector)],
			new WatchExpressionsDataSource(), {
			accessibilityProvider: new WatchExpressionsAccessibilityProvider(),
			identityProvider: { getId: (element: IExpression) => element.getId() },
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (e: IExpression) => {
					if (e === this.debugService.getViewModel().getSelectedExpression()?.expression) {
						// Don't filter input box
						return undefined;
					}

					return e.name;
				}
			},
			dnd: new WatchExpressionsDragAndDrop(this.debugService),
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			}
		});
		this.tree.setInput(this.debugService);
		CONTEXT_DESYNT_FOCUSED.bindTo(this.tree.contextKeyService);
		//my code adding button of synthesis options
		let clicked = false;
		let controller = new AbortController();
		button.label = buttonLabel;
		this._register(button.onDidClick(async () => {
			if (clicked) {
				button.label = 'Cancled';
				controller.abort();
				clicked = false;
				controller = new AbortController();
				return;

			}
			clicked = true;
			let count = 3;
			button.label = 'Loading' + ('.'.repeat(count));
			const animation = setInterval(() => {
				count = (count + 1) % 4;
				button.label = 'Loading' + ('.'.repeat(count));
			}, 2000);
			const session = await this.debugService.getViewModel().focusedSession;
			const stackFrame = await this.debugService.getViewModel().focusedStackFrame;
			if (session && stackFrame) {
				const syntDictEvaluation = '__import__(\'json\').dumps(synt_dict,cls=MyEncoder)';
				const SyntDict = await session.evaluate(syntDictEvaluation, stackFrame.frameId);
				if (SyntDict) {
					// const SyntDictJson = JSON.parse(SyntDict.body.result.replaceAll('\'', '').replaceAll(/\bNaN\b/g, '"NaN"'));
					const SyntDictJson = JSON.parse(SyntDict.body.result.replaceAll('\'{', '{').replaceAll('}\'', '}').replaceAll('\\\'', '\\\"').replaceAll(/\bNaN\b/g, '"NaN"'));
					//if (Object.keys(SyntDictJson).length === 0) {//empty object
					//	await this.ad_hoc_alter_val();
					//	const newSyntDict = await session.evaluate(syntDictEvaluation, stackFrame.frameId);
					//	SyntDictJson = JSON.parse(newSyntDict!.body.result.replaceAll('\'', '').replaceAll(/\bNaN\b/g, '"NaN"'));
					//}
					try {
						await this.synthesize(SyntDictJson, session, stackFrame, controller);
						//await this.sendToSynthesizer(SyntDictJson, controller);
					} catch (e) {
						if (e.message === 'Cancled') {
							this.notificationSer.info('Cancled');
						} else {
							this.notificationSer.warn('Synthesizer Failed , check logs for additional data');
							console.log('problem sending to synthesizer with exception', e);
						}
					}
					clicked = false;
					clearInterval(animation);
					button.label = buttonLabel;
				}
			}
		}));
		//end
		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));
		this._register(this.tree.onMouseDblClick(e => this.onMouseDblClick(e)));
		this._register(this.debugService.getModel().onDidChangeWatchExpressions(async we => {
			if (we && !(we as Expression).inDesynt) {
				return;
			}
			this.watchExpressionsExist.set(this.debugService.getModel().getWatchExpressions(true).length > 0);
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
			} else {
				if (we && !we.name) {
					// We are adding a new input box, no need to re-evaluate watch expressions
					useCachedEvaluation = true;
				}
				await this.tree.updateChildren();
				useCachedEvaluation = false;
				if (we instanceof Expression) {
					this.tree.reveal(we);
				}
			}
		}));
		this._register(this.debugService.getViewModel().onDidFocusStackFrame(() => {
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
				return;
			}

			if (!this.watchExpressionsUpdatedScheduler.isScheduled()) {
				this.watchExpressionsUpdatedScheduler.schedule();
			}
		}));
		this._register(this.debugService.getViewModel().onWillUpdateViews(() => {
			if (!ignoreViewUpdates) {
				this.tree.updateChildren();
			}
		}));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.watchExpressionsUpdatedScheduler.schedule();
			}
		}));
		let horizontalScrolling: boolean | undefined;
		this._register(this.debugService.getViewModel().onDidSelectExpression(e => {
			const expression = e?.expression;
			if (expression && !(expression as Expression).inDesynt) {
				return;
			}

			if (expression instanceof Expression || (expression instanceof Variable && e?.settingWatch)) {
				horizontalScrolling = this.tree.options.horizontalScrolling;
				if (horizontalScrolling) {
					this.tree.updateOptions({ horizontalScrolling: false });
				}

				if (expression.name) {
					// Only rerender if the input is already done since otherwise the tree is not yet aware of the new element
					this.tree.rerender(expression);
				}
			} else if (!expression && horizontalScrolling !== undefined) {
				this.tree.updateOptions({ horizontalScrolling: horizontalScrolling });
				horizontalScrolling = undefined;
			}
		}));

		this._register(this.debugService.getViewModel().onDidEvaluateLazyExpression(async e => {
			if (e instanceof Variable && this.tree.hasNode(e)) {
				await this.tree.updateChildren(e, false, true);
				await this.tree.expand(e);
			}
		}));
		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: 'desynt.runOrCancel',
			weight: KeybindingWeight.WorkbenchContrib,
			primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyD, KeyMod.CtrlCmd | KeyCode.KeyS),
			when: CONTEXT_IN_DEBUG_MODE,
			handler: async (accessor: ServicesAccessor) => {
				const clickEvent = new Event('click', {
					bubbles: true,
					cancelable: true
				});
				button.element.dispatchEvent(clickEvent);
			}
		});

	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	override focus(): void {
		this.tree.domFocus();
	}

	collapseAll(): void {
		this.tree.collapseAll();
	}
	private onMouseDblClick(e: ITreeMouseEvent<IExpression>): void {
		if ((e.browserEvent.target as HTMLElement).className.indexOf('twistie') >= 0) {
			// Ignore double click events on twistie
			return;
		}

		const element = e.element;
		// double click on primitive value: open input box to be able to select and copy value.
		const selectedExpression = this.debugService.getViewModel().getSelectedExpression();
		if (element instanceof Expression && element !== selectedExpression?.expression && element.inDesynt) {
			this.debugService.getViewModel().setSelectedExpression(element, false);
		} else if (!element) {
			// Double click in watch panel triggers to add a new watch expression
			this.debugService.addDesyntWatchExpression();
		}
	}

	private onContextMenu(e: ITreeContextMenuEvent<IExpression>): void {
		const element = e.element;
		const selection = this.tree.getSelection();
		if (element instanceof Expression && !element.inDesynt) {
			return;
		}
		this.watchItemType.set(element instanceof Expression ? 'expression' : element instanceof Variable ? 'variable' : undefined);
		const actions: IAction[] = [];
		const attributes = element instanceof Variable ? element.presentationHint?.attributes : undefined;
		this.variableReadonly.set(!!attributes && attributes.indexOf('readOnly') >= 0 || !!element?.presentationHint?.lazy);
		createAndFillInContextMenuActions(this.menu, { arg: element, shouldForwardArgs: true }, actions);
		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => element && selection.includes(element) ? selection : element ? [element] : [],
		});
	}
	private async sendToSynthesizer(variablesData: Object, controller: AbortController) {
		const signal = controller.signal;
		const uri = new URL(`${SynthesizerUrl}:${SynthesizerPort}/${SythesisRequestRoute}`);
		const sto = setTimeout(() => { timedout = true; controller.abort(); }, SynthesisTimeoutInMiliSeconds);
		let timedout = false;
		let userAbort = false;
		const res = await fetch(uri,
			{
				method: 'POST',
				headers: {
					'Access-Control-Allow-Origin': '*',
				},
				body: JSON.stringify(variablesData),
				signal: signal

			}
		).catch(error => {
			if (error.name === 'AbortError') {
				if (!timedout) {
					userAbort = true;
				}
				console.log('synthesizer timeout');
			} else {
				console.log('unkown error');
			}

		});
		clearTimeout(sto);
		if (timedout) {
			throw new Error('Timeout');
		}
		if (userAbort) {
			throw new Error('Cancled');
		}
		if (!res) {
			throw new Error('Synthesizer Timeout');
		}
		const json = await res.json();
		console.log(json);

		if (json.program) {
			this.solution = true;
			const programDetails = json.program;
			//const pattern = '??';
			this.candidateExist.set(true);
			updateForgetScopes(false);
			this.debugService.getViewModel().updateViews();
			await this.updateDebugger(programDetails.line, programDetails.synthesized_program);
		}
	}
	private async updateDebugger(line: number, program: string) {
		const session = await this.debugService.getViewModel().focusedSession;
		const stackFrame = await this.debugService.getViewModel().focusedStackFrame;
		if (session && stackFrame) {
			const syntDictEvaluation = `synt_dict[${line}].update({'solution':'${program.replaceAll('\'', '\\\'')}','overrideValue': None})`;
			const SyntDict = await session.evaluate(syntDictEvaluation, stackFrame.frameId);
			console.log(SyntDict);
			this.notificationSer.info(`Successully synthesized program for line: ${line}`);
		}
	}
}
class WatchExpressionsDelegate implements IListVirtualDelegate<IExpression> {

	getHeight(_element: IExpression): number {
		return 22;
	}

	getTemplateId(element: IExpression): string {
		if (element instanceof Expression) {
			return WatchExpressionsRenderer.ID;
		}

		// Variable
		return VariablesRenderer.ID;
	}
}

function isDebugService(element: any): element is IDebugService {
	return typeof element.getConfigurationManager === 'function';
}

class WatchExpressionsDataSource implements IAsyncDataSource<IDebugService, IExpression> {

	hasChildren(element: IExpression | IDebugService): boolean {
		return isDebugService(element) || element.hasChildren;
	}

	getChildren(element: IDebugService | IExpression): Promise<Array<IExpression>> {
		if (isDebugService(element)) {
			const debugService = element as IDebugService;
			const watchExpressions = debugService.getModel().getWatchExpressions(true);
			const viewModel = debugService.getViewModel();
			return Promise.all(watchExpressions.map(we => !!we.name && !useCachedEvaluation
				? we.evaluate(viewModel.focusedSession!, viewModel.focusedStackFrame!, 'watch').then(() => we)
				: Promise.resolve(we)));
		}

		return element.getChildren();
	}
}


class WatchExpressionsRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'watchexpression';

	constructor(
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IDebugService debugService: IDebugService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super(debugService, contextViewService);
	}

	get templateId() {
		return WatchExpressionsRenderer.ID;
	}

	protected renderExpression(expression: IExpression, data: IExpressionTemplateData, highlights: IHighlight[]): void {
		if (expression instanceof Expression && !expression.inDesynt) {
			return;
		}
		const text = typeof expression.value === 'string' ? `${expression.name}:` : expression.name;
		let title: string;
		if (expression.type) {
			title = expression.type === expression.value ?
				expression.type :
				`${expression.type}: ${expression.value}`;
		} else {
			title = expression.value;
		}

		data.label.set(text, highlights, title);
		renderExpressionValue(expression, data.value, {
			showChanged: true,
			maxValueLength: MAX_VALUE_RENDER_LENGTH_IN_VIEWLET,
			showHover: true,
			colorize: true
		});
	}

	protected getInputBoxOptions(expression: IExpression, settingValue: boolean): IInputBoxOptions {
		if (settingValue) {
			return {
				initialValue: expression.value,
				ariaLabel: localize('typeNewValue', "Type new value"),
				onFinish: async (value: string, success: boolean) => {
					if (success && value) {
						const focusedFrame = this.debugService.getViewModel().focusedStackFrame;
						if (focusedFrame && (expression instanceof Variable || expression instanceof Expression)) {
							await expression.setExpression(value, focusedFrame);
							this.debugService.getViewModel().updateViews();
						}
					}
				}
			};
		}

		return {
			initialValue: expression.name ? expression.name : '',
			ariaLabel: localize('watchExpressionInputAriaLabel', "Type watch expression"),
			placeholder: localize('watchExpressionPlaceholder', "Expression to watch"),
			onFinish: (value: string, success: boolean) => {
				if (success && value) {
					this.debugService.renameWatchExpression(expression.getId(), value);
					ignoreViewUpdates = true;
					this.debugService.getViewModel().updateViews();
					ignoreViewUpdates = false;
				} else if (!expression.name) {
					this.debugService.removeWatchExpressions(expression.getId());
				}
			}
		};
	}

	protected override renderActionBar(actionBar: ActionBar, expression: IExpression) {
		const contextKeyService = getContextForWatchExpressionMenu(this.contextKeyService, expression);
		const menu = this.menuService.createMenu(MenuId.DebugWatchContext, contextKeyService);

		const primary: IAction[] = [];
		const context = expression;
		createAndFillInContextMenuActions(menu, { arg: context, shouldForwardArgs: false }, { primary, secondary: [] }, 'inline');

		actionBar.clear();
		actionBar.context = context;
		actionBar.push(primary, { icon: true, label: false });
	}
}

/**
 * Gets a context key overlay that has context for the given expression.
 */
function getContextForWatchExpressionMenu(parentContext: IContextKeyService, expression: IExpression) {
	return parentContext.createOverlay([
		[CONTEXT_CAN_VIEW_MEMORY.key, expression.memoryReference !== undefined],
		[CONTEXT_WATCH_ITEM_TYPE.key, 'expression']
	]);
}

class WatchExpressionsAccessibilityProvider implements IListAccessibilityProvider<IExpression> {

	getWidgetAriaLabel(): string {
		return localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'watchAriaTreeLabel' }, "Debug Watch Expressions");
	}

	getAriaLabel(element: IExpression): string {
		if (element instanceof Expression) {
			return localize('watchExpressionAriaLabel', "{0}, value {1}", (<Expression>element).name, (<Expression>element).value);
		}

		// Variable
		return localize('watchVariableAriaLabel', "{0}, value {1}", (<Variable>element).name, (<Variable>element).value);
	}
}

class WatchExpressionsDragAndDrop implements ITreeDragAndDrop<IExpression> {

	constructor(private debugService: IDebugService) { }

	onDragOver(data: IDragAndDropData): boolean | ITreeDragOverReaction {
		if (!(data instanceof ElementsDragAndDropData)) {
			return false;
		}

		const expressions = (data as ElementsDragAndDropData<IExpression>).elements;
		return expressions.length > 0 && expressions[0] instanceof Expression;
	}

	getDragURI(element: IExpression): string | null {
		if (!(element instanceof Expression) || element === this.debugService.getViewModel().getSelectedExpression()?.expression) {
			return null;
		}

		return element.getId();
	}

	getDragLabel(elements: IExpression[]): string | undefined {
		if (elements.length === 1) {
			return elements[0].name;
		}

		return undefined;
	}

	drop(data: IDragAndDropData, targetElement: IExpression): void {
		if (!(data instanceof ElementsDragAndDropData)) {
			return;
		}

		const draggedElement = (data as ElementsDragAndDropData<IExpression>).elements[0];
		const watches = this.debugService.getModel().getWatchExpressions(true);
		const position = targetElement instanceof Expression ? watches.indexOf(targetElement) : watches.length - 1;
		this.debugService.moveWatchExpression(draggedElement.getId(), position);
	}
}
//need to fix those
registerAction2(class Collapse extends ViewAction<DeSyntView> {
	constructor() {
		super({
			id: 'desynt.collapse',
			viewId: DESYNT_VIEW_ID,
			title: localize('collapse', "Collapse All"),
			f1: false,
			icon: Codicon.collapseAll,
			precondition: CONTEXT_DESYNT_EXIST,
			menu: {
				id: MenuId.ViewTitle,
				order: 30,
				group: 'navigation',
				when: ContextKeyExpr.equals('view', DESYNT_VIEW_ID)
			}
		});
	}

	runInView(_accessor: ServicesAccessor, view: DeSyntView) {
		view.collapseAll();
	}
});

export const ADD_WATCH_ID = 'workbench.debug.viewlet.action.addWatchExpressionDesynt'; // Use old and long id for backwards compatibility
export const ADD_WATCH_LABEL = localize('addWatchExpression', "Add Expression");

registerAction2(class AddWatchExpressionAction extends Action2 {
	constructor() {
		super({
			id: ADD_WATCH_ID,
			title: ADD_WATCH_LABEL,
			f1: false,
			icon: watchExpressionsAdd,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyExpr.equals('view', DESYNT_VIEW_ID)
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const debugService = accessor.get(IDebugService);
		debugService.addDesyntWatchExpression();
	}
});

export const REMOVE_DESYNT_EXPRESSIONS_COMMAND_ID = 'workbench.debug.viewlet.action.removeAllDesyntExpressions';
export const REMOVE_WATCH_EXPRESSIONS_LABEL = localize('removeAllWatchExpressions', "Remove All Expressions");
registerAction2(class RemoveAllWatchExpressionsAction extends Action2 {
	constructor() {
		super({
			id: REMOVE_DESYNT_EXPRESSIONS_COMMAND_ID, // Use old and long id for backwards compatibility
			title: REMOVE_WATCH_EXPRESSIONS_LABEL,
			f1: false,
			icon: watchExpressionsRemoveAll,
			precondition: CONTEXT_DESYNT_EXIST,
			menu: {
				id: MenuId.ViewTitle,
				order: 20,
				group: 'navigation',
				when: ContextKeyExpr.equals('view', DESYNT_VIEW_ID)
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const debugService = accessor.get(IDebugService);
		debugService.removeWatchExpressions();
	}
});
