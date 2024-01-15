/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { TreeFindMode } from 'vs/base/browser/ui/tree/abstractTree';
import type { ICompressedTreeNode } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import type { ICompressibleTreeRenderer } from 'vs/base/browser/ui/tree/objectTree';
import { ITreeElement, ITreeFilter, ITreeMouseEvent, ITreeNode, TreeFilterResult, TreeVisibility } from 'vs/base/browser/ui/tree/tree';
import { RunOnceScheduler } from 'vs/base/common/async';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { normalizeDriveLetter, tildify } from 'vs/base/common/labels';
import { dispose } from 'vs/base/common/lifecycle';
import { isAbsolute, normalize, posix } from 'vs/base/common/path';
import { isWindows } from 'vs/base/common/platform';
import { ltrim } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { FileKind } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILabelService } from 'vs/platform/label/common/label';
import { WorkbenchCompressibleObjectTree } from 'vs/platform/list/browser/listService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IResourceLabel, IResourceLabelOptions, IResourceLabelProps, ResourceLabels } from 'vs/workbench/browser/labels';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { renderViewTree } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { CONTEXT_DESYNT_HISTORY_ITEM_TYPE, IDebugService, IDebugSession, State, } from 'vs/workbench/contrib/debug/common/debug';
import { DebugContentProvider } from 'vs/workbench/contrib/debug/common/debugContentProvider';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

const NEW_STYLE_COMPRESS = true;

// RFC 2396, Appendix A: https://www.ietf.org/rfc/rfc2396.txt
const URI_SCHEMA_PATTERN = /^[a-zA-Z][a-zA-Z0-9\+\-\.]+:/;

type DesyntHistoryItem = BaseTreeItem;

class BaseTreeItem {

	private _showedMoreThanOne: boolean;
	private _children = new Map<string, BaseTreeItem>();
	private _source: Source | undefined;

	constructor(private _parent: BaseTreeItem | undefined, private _label: string, public readonly isIncompressible = false) {
		this._showedMoreThanOne = false;
	}

	updateLabel(label: string) {
		this._label = label;
	}

	isLeaf(): boolean {
		return this._children.size === 0;
	}

	getSession(): IDebugSession | undefined {
		if (this._parent) {
			return this._parent.getSession();
		}
		return undefined;
	}

	setSource(session: IDebugSession, source: Source): void {
		this._source = source;
		this._children.clear();
		if (source.raw && source.raw.sources) {
			for (const src of source.raw.sources) {
				if (src.name && src.path) {
					const s = new BaseTreeItem(this, src.name);
					this._children.set(src.path, s);
					const ss = session.getSource(src);
					s.setSource(session, ss);
				}
			}
		}
	}
	create<T extends BaseTreeItem>(key: string, child: T): T {
		this._children.set(key, child);
		return child;
	}
	createIfNeeded<T extends BaseTreeItem>(key: string, factory: (parent: BaseTreeItem, label: string) => T): T {
		let child = <T>this._children.get(key);
		if (!child) {
			child = factory(this, key);
			this._children.set(key, child);
		}
		return child;
	}

	getChild(key: string): BaseTreeItem | undefined {
		return this._children.get(key);
	}

	removeAll(): void {
		this._children.clear();
	}
	remove(key: string): void {
		this._children.delete(key);
	}

	removeFromParent(): void {
		if (this._parent) {
			this._parent.remove(this._label);
			if (this._parent._children.size === 0) {
				this._parent.removeFromParent();
			}
		}
	}

	getTemplateId(): string {
		return 'id';
	}

	// a dynamic ID based on the parent chain; required for reparenting (see #55448)
	getId(): string {
		const parent = this.getParent();
		return parent ? `${parent.getId()}/${this.getInternalId()}` : this.getInternalId();
	}

	getInternalId(): string {
		return this._label;
	}

	// skips intermediate single-child nodes
	getParent(): BaseTreeItem | undefined {
		if (this._parent) {
			if (this._parent.isSkipped()) {
				return this._parent.getParent();
			}
			return this._parent;
		}
		return undefined;
	}

	isSkipped(): boolean {
		if (this._parent) {
			if (this._parent.oneChild()) {
				return true;	// skipped if I'm the only child of my parents
			}
			return false;
		}
		return true;	// roots are never skipped
	}

	// skips intermediate single-child nodes
	hasChildren(): boolean {
		const child = this.oneChild();
		if (child) {
			return child.hasChildren();
		}
		return this._children.size > 0;
	}

	// skips intermediate single-child nodes
	getChildren(): BaseTreeItem[] {
		/*const child = this.oneChild();
		if (child) {
			return child.getChildren();
		}*/
		const keys = [...this._children.keys()].sort((a, b) => {
			if (!this._label.startsWith('iteration')) {
				return parseInt(b) - parseInt(a);
			}
			return parseInt(b.split(',')[1]) - parseInt(a.split(',')[1]);
		});
		const array: BaseTreeItem[] = [];
		//for (const child of this._children.values()) {
		for (const k of keys) {
			array.push(this._children.get(k)!);
		}
		return array;
		//return array.sort((a, b) => this.compare(a, b));
	}

	// skips intermediate single-child nodes
	getLabel(separateRootFolder = true): string {
		const child = this.oneChild();
		if (child) {
			const sep = (this instanceof RootFolderTreeItem && separateRootFolder) ? ' • ' : posix.sep;
			return `${this._label}${sep}${child.getLabel()}`;
		}
		return this._label;
	}

	// skips intermediate single-child nodes
	getHoverLabel(): string | undefined {
		if (this._source && this._parent && this._parent._source) {
			return this._source.raw.path || this._source.raw.name;
		}
		const label = this.getLabel(false);
		const parent = this.getParent();
		if (parent) {
			const hover = parent.getHoverLabel();
			if (hover) {
				return `${hover}/${label}`;
			}
		}
		return label;
	}

	// skips intermediate single-child nodes
	getSource(): Source | undefined {
		const child = this.oneChild();
		if (child) {
			return child.getSource();
		}
		return this._source;
	}

	protected compare(a: BaseTreeItem, b: BaseTreeItem): number {
		if (a._label && b._label) {
			return a._label.localeCompare(b._label);
		}
		return 0;
	}

	private oneChild(): BaseTreeItem | undefined {
		if (!this._source && !this._showedMoreThanOne && this.skipOneChild()) {
			if (this._children.size === 1) {
				return this._children.values().next().value;
			}
			// if a node had more than one child once, it will never be skipped again
			if (this._children.size > 1) {
				this._showedMoreThanOne = true;
			}
		}
		return undefined;
	}

	private skipOneChild(): boolean {
		if (NEW_STYLE_COMPRESS) {
			// if the root node has only one Session, don't show the session
			return this instanceof RootTreeItem;
		} else {
			return !(this instanceof RootFolderTreeItem) && !(this instanceof SessionTreeItem);
		}
	}
}

class RootFolderTreeItem extends BaseTreeItem {

	constructor(parent: BaseTreeItem, public folder: IWorkspaceFolder) {
		super(parent, folder.name, true);
	}
}

class DesyntHistoryTreeItem extends BaseTreeItem {

	constructor(parent: BaseTreeItem, public operation: string) {
		super(parent, operation, true);
	}
}

class RootTreeItem extends BaseTreeItem {

	constructor(private _pathService: IPathService, private _contextService: IWorkspaceContextService, private _labelService: ILabelService) {
		super(undefined, 'Root');
	}

	add(session: IDebugSession): SessionTreeItem {
		return this.createIfNeeded(session.getId(), () => new SessionTreeItem(this._labelService, this, session, this._pathService, this._contextService));
	}
	addDesynt(event: ITreeMouseEvent<BaseTreeItem | null>): DesyntHistoryTreeItem {
		return this.createIfNeeded(event.element?.getId() ?? 'debug', () => new DesyntHistoryTreeItem(this, event.element?.getId() ?? 'debug'));
	}
	find(session: IDebugSession): SessionTreeItem {
		return <SessionTreeItem>this.getChild(session.getId());
	}
}

class SessionTreeItem extends BaseTreeItem {

	private static readonly URL_REGEXP = /^(https?:\/\/[^/]+)(\/.*)$/;

	private _session: IDebugSession;
	private _map = new Map<string, BaseTreeItem>();
	private _labelService: ILabelService;

	constructor(labelService: ILabelService, parent: BaseTreeItem, session: IDebugSession, private _pathService: IPathService, private rootProvider: IWorkspaceContextService) {
		super(parent, session.getLabel(), true);
		this._labelService = labelService;
		this._session = session;
	}

	override getInternalId(): string {
		return this._session.getId();
	}

	override getSession(): IDebugSession {
		return this._session;
	}

	override getHoverLabel(): string | undefined {
		return undefined;
	}

	override hasChildren(): boolean {
		return true;
	}

	protected override compare(a: BaseTreeItem, b: BaseTreeItem): number {
		const acat = this.category(a);
		const bcat = this.category(b);
		if (acat !== bcat) {
			return acat - bcat;
		}
		return super.compare(a, b);
	}

	private category(item: BaseTreeItem): number {

		// workspace scripts come at the beginning in "folder" order
		if (item instanceof RootFolderTreeItem) {
			return item.folder.index;
		}

		// <...> come at the very end
		const l = item.getLabel();
		if (l && /^<.+>$/.test(l)) {
			return 1000;
		}

		// everything else in between
		return 999;
	}

	async addPath(source: Source): Promise<void> {

		let folder: IWorkspaceFolder | null;
		let url: string;

		let path = source.raw.path;
		if (!path) {
			return;
		}

		if (this._labelService && URI_SCHEMA_PATTERN.test(path)) {
			path = this._labelService.getUriLabel(URI.parse(path));
		}

		const match = SessionTreeItem.URL_REGEXP.exec(path);
		if (match && match.length === 3) {
			url = match[1];
			path = decodeURI(match[2]);
		} else {
			if (isAbsolute(path)) {
				const resource = URI.file(path);

				// return early if we can resolve a relative path label from the root folder
				folder = this.rootProvider ? this.rootProvider.getWorkspaceFolder(resource) : null;
				if (folder) {
					// strip off the root folder path
					path = normalize(ltrim(resource.path.substring(folder.uri.path.length), posix.sep));
					const hasMultipleRoots = this.rootProvider.getWorkspace().folders.length > 1;
					if (hasMultipleRoots) {
						path = posix.sep + path;
					} else {
						// don't show root folder
						folder = null;
					}
				} else {
					// on unix try to tildify absolute paths
					path = normalize(path);
					if (isWindows) {
						path = normalizeDriveLetter(path);
					} else {
						path = tildify(path, (await this._pathService.userHome()).fsPath);
					}
				}
			}
		}

		let leaf: BaseTreeItem = this;
		path.split(/[\/\\]/).forEach((segment, i) => {
			if (i === 0 && folder) {
				const f = folder;
				leaf = leaf.createIfNeeded(folder.name, parent => new RootFolderTreeItem(parent, f));
			} else if (i === 0 && url) {
				leaf = leaf.createIfNeeded(url, parent => new BaseTreeItem(parent, url));
			} else {
				leaf = leaf.createIfNeeded(segment, parent => new BaseTreeItem(parent, segment));
			}
		});

		leaf.setSource(this._session, source);
		if (source.raw.path) {
			this._map.set(source.raw.path, leaf);
		}
	}

	removePath(source: Source): boolean {
		if (source.raw.path) {
			const leaf = this._map.get(source.raw.path);
			if (leaf) {
				leaf.removeFromParent();
				return true;
			}
		}
		return false;
	}
}

interface IViewState {
	readonly expanded: Set<string>;
}

/**
 * This maps a model item into a view model item.
 */
function asTreeElement(item: BaseTreeItem, viewState?: IViewState, iteration?: string): ITreeElement<DesyntHistoryItem> {
	const children = item.getChildren();
	const collapsed = viewState ? !viewState.expanded.has(item.getId()) : !(item instanceof SessionTreeItem) && !(iteration === item.getId());

	return {
		element: item,
		collapsed,
		collapsible: item.hasChildren(),
		children: children.map(i => asTreeElement(i, viewState, iteration))
	};
}

export class DesyntHistoryView extends ViewPane {

	private treeContainer!: HTMLElement;
	private desyntHistoryItemType: IContextKey<string>;
	private tree!: WorkbenchCompressibleObjectTree<DesyntHistoryItem, FuzzyScore>;
	private treeLabels!: ResourceLabels;
	private changeScheduler!: RunOnceScheduler;
	private treeNeedsRefreshOnVisible = true;
	private filter!: DesyntHistoryFilter;
	private keyRunningNumber: number = 0;
	private keyIteration: number = 1;
	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IDebugService private readonly debugService: IDebugService,
		@ILabelService private readonly labelService: ILabelService,
		@IPathService private readonly pathService: IPathService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.desyntHistoryItemType = CONTEXT_DESYNT_HISTORY_ITEM_TYPE.bindTo(contextKeyService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.element.classList.add('debug-pane');
		container.classList.add('debug-loaded-scripts');
		container.classList.add('show-file-icons');

		this.treeContainer = renderViewTree(container);

		this.filter = new DesyntHistoryFilter();

		const root = new RootTreeItem(this.pathService, this.contextService, this.labelService);

		this.treeLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this._register(this.treeLabels);

		this.tree = <WorkbenchCompressibleObjectTree<DesyntHistoryItem, FuzzyScore>>this.instantiationService.createInstance(WorkbenchCompressibleObjectTree,
			'DesyntHistoryView',
			this.treeContainer,
			new DesyntHistoryDelegate(),
			[new DesyntHistoryRenderer(this.treeLabels)],
			{
				compressionEnabled: NEW_STYLE_COMPRESS,
				collapseByDefault: true,
				hideTwistiesOfChildlessElements: true,
				identityProvider: {
					getId: (element: DesyntHistoryItem) => element.getId()
				},
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (element: DesyntHistoryItem) => {
						return element.getLabel();
					},
					getCompressedNodeKeyboardNavigationLabel: (elements: DesyntHistoryItem[]) => {
						return elements.map(e => e.getLabel()).join('/');
					}
				},
				filter: this.filter,
				accessibilityProvider: new DesyntHistoryAccessibilityProvider(),
				overrideStyles: {
					listBackground: this.getBackgroundColor()
				}
			}
		);

		const updateView = (viewState?: IViewState) => this.tree.setChildren(null, asTreeElement(root, viewState, 'iteration ' + this.keyIteration.toString()).children);

		updateView();

		this.changeScheduler = new RunOnceScheduler(() => {
			this.treeNeedsRefreshOnVisible = true;
			if (this.tree) {
				updateView();
			}
		}, 300);
		this._register(this.changeScheduler);

		this._register(this.tree.onDidOpen(e => {
			if (e.element instanceof BaseTreeItem) {
				const source = e.element.getSource();
				if (source && source.available) {
					const nullRange = { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 };
					source.openInEditor(this.editorService, nullRange, e.editorOptions.preserveFocus, e.sideBySide, e.editorOptions.pinned);
				}
			}
		}));

		this._register(this.tree.onDidChangeFocus(() => {
			const focus = this.tree.getFocus();
			if (focus instanceof SessionTreeItem) {
				this.desyntHistoryItemType.set('session');
			} else {
				this.desyntHistoryItemType.reset();
			}
		}));

		const scheduleRefreshOnVisible = () => {
			if (this.isBodyVisible()) {
				this.changeScheduler.schedule();
			} else {
				this.treeNeedsRefreshOnVisible = true;
			}
		};

		const addSourcePathsToSession = async (session: IDebugSession) => {
			if (session.capabilities.supportsLoadedSourcesRequest) {
				const sessionNode = root.add(session);
				const paths = await session.getLoadedSources();
				for (const path of paths) {
					await sessionNode.addPath(path);
				}
				scheduleRefreshOnVisible();
			}
		};

		const registerSessionListeners = (session: IDebugSession) => {
			this._register(this.debugService.onDidChangeState((e) => {
				if (e === State.Stopped) {
					this.keyRunningNumber = 0;
					if (root.getChild(this.keyIteration.toString())) {
						this.keyIteration += 1;
						this.storageService.desyntIteration += 1; // rough
					}
				}
				if (e === State.Inactive || e === State.Initializing) {
					this.keyRunningNumber = 0;
					this.keyIteration = 1;
					root.removeAll();
					scheduleRefreshOnVisible();
				}
			}
			));
			this._register(this.storageService.onDidChangeValue(async e => {
				// TODO: Currently won't work between iterations with the same value
				// Done by changing the storagaeService to also hold to keyiteration so it can be accessed from the hover widget
				// its crap
				const desired_key = (this.debugService.getViewModel()?.focusedSession?.getId() ?? 'desynt') + this.storageService.desyntIteration.toString();
				if (e.key === desired_key) {
					const value = this.storageService.get(desired_key, StorageScope.APPLICATION);
					if (e.target === StorageTarget.MACHINE && e.scope === StorageScope.APPLICATION && value) {
						await this.addChangeToDesyntView(root, value);
						scheduleRefreshOnVisible();
					}
				}

			}, this));
			this._register(session.onDidChangeName(async () => {
				const sessionRoot = root.find(session);
				if (sessionRoot) {
					sessionRoot.updateLabel(session.getLabel());
					scheduleRefreshOnVisible();
				}
			}));
			this._register(session.onDidLoadedSource(async event => {
				let sessionRoot: SessionTreeItem;
				switch (event.reason) {
					case 'new':
					case 'changed':
						sessionRoot = root.add(session);
						await sessionRoot.addPath(event.source);
						scheduleRefreshOnVisible();
						if (event.reason === 'changed') {
							DebugContentProvider.refreshDebugContent(event.source.uri);
						}
						break;
					case 'removed':
						sessionRoot = root.find(session);
						if (sessionRoot && sessionRoot.removePath(event.source)) {
							scheduleRefreshOnVisible();
						}
						break;
					default:
						this.filter.setFilter(event.source.name);
						this.tree.refilter();
						break;
				}
			}));
		};

		this._register(this.debugService.onDidNewSession(registerSessionListeners));
		this.debugService.getModel().getSessions().forEach(registerSessionListeners);

		this._register(this.debugService.onDidEndSession(session => {
			root.remove(session.getId());
			this.changeScheduler.schedule();
		}));

		this.changeScheduler.schedule(0);
		this._register(this.tree.onMouseDblClick(e => {
			scheduleRefreshOnVisible();
		}));
		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.treeNeedsRefreshOnVisible) {
				this.changeScheduler.schedule();
			}
		}));

		// feature: expand all nodes when filtering (not when finding)
		let viewState: IViewState | undefined;
		this._register(this.tree.onDidChangeFindPattern(pattern => {
			if (this.tree.findMode === TreeFindMode.Highlight) {
				return;
			}

			if (!viewState && pattern) {
				const expanded = new Set<string>();
				const visit = (node: ITreeNode<BaseTreeItem | null, FuzzyScore>) => {
					if (node.element && !node.collapsed) {
						expanded.add(node.element.getId());
					}

					for (const child of node.children) {
						visit(child);
					}
				};

				visit(this.tree.getNode());
				viewState = { expanded };
				this.tree.expandAll();
			} else if (!pattern && viewState) {
				this.tree.setFocus([]);
				updateView(viewState);
				viewState = undefined;
			}
		}));

		// populate tree model with source paths from all debug sessions
		this.debugService.getModel().getSessions().forEach(session => addSourcePathsToSession(session));
	}
	async addChangeToDesyntView(root: RootTreeItem, value: string) {
		const key = this.keyIteration.toString() + ',' + this.keyRunningNumber.toString();
		let currentParentItem: DesyntHistoryTreeItem;
		const parentKey = this.keyIteration.toString();
		if (this.keyRunningNumber === 0) {//new row
			const parentItem = new DesyntHistoryTreeItem(root, 'iteration ' + this.keyIteration.toString());
			root.create(parentKey, parentItem);
			currentParentItem = parentItem;
			//add input items:
			const scopes = await this.debugService.getViewModel().focusedStackFrame?.getScopes();
			if (scopes) {
				const locals = await scopes[0].getChildren();
				if (locals) {
					const inputKey = this.keyIteration.toString() + ',-1';
					const inputItem = new DesyntHistoryTreeItem(parentItem, 'input variables');
					parentItem.create(inputKey, inputItem);
					let index = 0;
					for (const variable of locals) {
						const variableItem = new DesyntHistoryTreeItem(inputItem, variable.toString());
						inputItem.create(index.toString(), variableItem);
						index += 1;
					}

				}
			}
		}
		else {
			currentParentItem = root.getChild(parentKey) as DesyntHistoryTreeItem;
		}

		currentParentItem.createIfNeeded(key, () => new DesyntHistoryTreeItem(currentParentItem, 'set sketch value to: ' + value));
		// this.keyRunningNumber += 1; // Commented to to have new sketch values replace previous ones instead of accumulating sketches
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	override dispose(): void {
		dispose(this.tree);
		dispose(this.treeLabels);
		super.dispose();
	}
}

class DesyntHistoryDelegate implements IListVirtualDelegate<DesyntHistoryItem> {

	getHeight(element: DesyntHistoryItem): number {
		return 22;
	}

	getTemplateId(element: DesyntHistoryItem): string {
		return DesyntHistoryRenderer.ID;
	}
}

interface IDesyntHistoryItemTemplateData {
	label: IResourceLabel;
}

class DesyntHistoryRenderer implements ICompressibleTreeRenderer<BaseTreeItem, FuzzyScore, IDesyntHistoryItemTemplateData> {

	static readonly ID = 'lsrenderer';

	constructor(
		private labels: ResourceLabels
	) {
	}

	get templateId(): string {
		return DesyntHistoryRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IDesyntHistoryItemTemplateData {
		const label = this.labels.create(container, { supportHighlights: true });
		return { label };
	}

	renderElement(node: ITreeNode<BaseTreeItem, FuzzyScore>, index: number, data: IDesyntHistoryItemTemplateData): void {

		const element = node.element;
		const label = element.getLabel();

		this.render(element, label, data, node.filterData);
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<BaseTreeItem>, FuzzyScore>, index: number, data: IDesyntHistoryItemTemplateData, height: number | undefined): void {

		const element = node.element.elements[node.element.elements.length - 1];
		const labels = node.element.elements.map(e => e.getLabel());

		this.render(element, labels, data, node.filterData);
	}

	private render(element: BaseTreeItem, labels: string | string[], data: IDesyntHistoryItemTemplateData, filterData: FuzzyScore | undefined) {

		const label: IResourceLabelProps = {
			name: labels
		};
		const options: IResourceLabelOptions = {
			title: element.getHoverLabel()
		};

		if (element instanceof RootFolderTreeItem) {

			options.fileKind = FileKind.ROOT_FOLDER;

		} else if (element instanceof SessionTreeItem) {

			options.title = nls.localize('desyntHistorySession', "Debug Session");
			options.hideIcon = true;

		} else if (element instanceof DesyntHistoryTreeItem) {

			options.title = nls.localize('desyntHistoryTreeItem', "Debug Session");
			options.hideIcon = true;

		} else if (element instanceof BaseTreeItem) {

			const src = element.getSource();
			if (src && src.uri) {
				label.resource = src.uri;
				options.fileKind = FileKind.FILE;
			} else {
				options.fileKind = FileKind.FOLDER;
			}
		}
		options.matches = createMatches(filterData);

		data.label.setResource(label, options);
	}

	disposeTemplate(templateData: IDesyntHistoryItemTemplateData): void {
		templateData.label.dispose();
	}
}

class DesyntHistoryAccessibilityProvider implements IListAccessibilityProvider<DesyntHistoryItem> {

	getWidgetAriaLabel(): string {
		return nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'desyntHistoryAriaLabel' }, "Debug Loaded Scripts");
	}

	getAriaLabel(element: DesyntHistoryItem): string {

		if (element instanceof RootFolderTreeItem) {
			return nls.localize('desyntHistoryRootFolderAriaLabel', "Workspace folder {0}, loaded script, debug", element.getLabel());
		}

		if (element instanceof SessionTreeItem) {
			return nls.localize('desyntHistorySessionAriaLabel', "Session {0}, loaded script, debug", element.getLabel());
		}

		if (element instanceof DesyntHistoryTreeItem) {
			return nls.localize('desyntHistoryTreeItemAriaLabel', "Session {0}, loaded script, debug", element.getLabel());
		}

		if (element.hasChildren()) {
			return nls.localize('desyntHistoryFolderAriaLabel', "Folder {0}, loaded script, debug", element.getLabel());
		} else {
			return nls.localize('desyntHistorySourceAriaLabel', "{0}, loaded script, debug", element.getLabel());
		}
	}
}

class DesyntHistoryFilter implements ITreeFilter<BaseTreeItem, FuzzyScore> {

	private filterText: string | undefined;

	setFilter(filterText: string) {
		this.filterText = filterText;
	}

	filter(element: BaseTreeItem, parentVisibility: TreeVisibility): TreeFilterResult<FuzzyScore> {

		if (!this.filterText) {
			return TreeVisibility.Visible;
		}

		if (element.isLeaf()) {
			const name = element.getLabel();
			if (name.indexOf(this.filterText) >= 0) {
				return TreeVisibility.Visible;
			}
			return TreeVisibility.Hidden;
		}
		return TreeVisibility.Recurse;
	}
}
