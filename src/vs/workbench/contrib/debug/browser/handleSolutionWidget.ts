/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ActionBar, ActionsOrientation, IActionBarOptions } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Codicon } from 'vs/base/common/codicons';
import { Color } from 'vs/base/common/color';
import { Emitter } from 'vs/base/common/event';
import { ThemeIcon } from 'vs/base/common/themables';
import 'vs/css!./media/exceptionWidget';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ZoneWidget } from 'vs/editor/contrib/zoneWidget/browser/zoneWidget';
import * as nls from 'vs/nls';
import { createActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';

// theming

const debughandleSolutionWidgetBorder = registerColor('debugHandleSolutionWidget.border', { dark: '#a31515', light: '#a31515', hcDark: '#a31515', hcLight: '#a31515' }, nls.localize('debugHandleSolutionWidgetBorder', 'HandleSolution widget border color.'));
const debughandleSolutionWidgetBackground = registerColor('debugHandleSolutionWidget.background', { dark: '#0b420b', light: '#def1df', hcDark: '#0d420b', hcLight: '#def1df' }, nls.localize('debugHandleSolutionWidgetBackground', 'HandleSolution widget background color.'));

export class HandleSolutionWidget extends ZoneWidget {

	private backgroundColor: Color | undefined;
	private readonly _onDidClose = new Emitter<HandleSolutionWidget>();
	readonly onDidClose = this._onDidClose.event;
	protected _actionbarWidget?: ActionBar;
	protected _headElement?: HTMLDivElement;
	private disposed?: true;

	constructor(
		editor: ICodeEditor,
		@IThemeService themeService: IThemeService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService
	) {
		super(editor, { showFrame: true, showArrow: true, isAccessible: true, frameWidth: 1, className: 'handleSolution-widget-container' });

		this.applyTheme(themeService.getColorTheme());
		this._disposables.add(themeService.onDidColorThemeChange(this.applyTheme.bind(this)));

		this.create();
		const onDidLayoutChangeScheduler = new RunOnceScheduler(() => this._doLayout(undefined, undefined), 50);
		this._disposables.add(this.editor.onDidLayoutChange(() => onDidLayoutChangeScheduler.schedule()));
		this._disposables.add(onDidLayoutChangeScheduler);
	}

	override dispose(): void {
		if (!this.disposed) {
			this.disposed = true; // prevent consumers who dispose on onDidClose from looping
			super.dispose();
			this._onDidClose.fire(this);
		}
	}

	private applyTheme(theme: IColorTheme): void {
		this.backgroundColor = theme.getColor(debughandleSolutionWidgetBackground);
		const frameColor = theme.getColor(debughandleSolutionWidgetBorder);
		this.style({
			arrowColor: frameColor,
			frameColor: frameColor
		}); // style() will trigger _applyStyles
	}

	protected override _applyStyles(): void {
		if (this.container) {
			this.container.style.backgroundColor = this.backgroundColor ? this.backgroundColor.toString() : '';
		}
		super._applyStyles();
	}

	protected _fillContainer(container: HTMLElement): void {
		this.setCssClass('handleSolution-widget');
		this._headElement = dom.$<HTMLDivElement>('.body');
		this._fillHead();
		container.appendChild(this._headElement);
	}

	// TODO: make the actionbar and headElement on same line
	protected _fillHead(): void {
		this._headElement!.innerText = 'Solution to handle...';
		const actionsContainer = dom.$('.handleSolution-actions');
		dom.append(this._headElement!, actionsContainer);

		const actionBarOptions = this._getActionBarOptions();
		this._actionbarWidget = new ActionBar(actionsContainer, actionBarOptions);
		this._disposables.add(this._actionbarWidget);

		this._actionbarWidget.push(new Action('handleSoultion.close', nls.localize('label.close', "Close"), ThemeIcon.asClassName(Codicon.close), true, () => {
			this.dispose();
			return Promise.resolve();
		}), { label: false, icon: true });
		this._actionbarWidget.push(new Action('handleSolution.accept', nls.localize('label.accept', "Accept"), ThemeIcon.asClassName(Codicon.check), true, () => {
			//TODO: Run ACCEPT_DESYNT action from here
			this.dispose();
			return Promise.resolve();
		}), { label: false, icon: true });
	}

	// Here we can add a check button
	protected _getActionBarOptions(): IActionBarOptions {
		return {
			actionViewItemProvider: createActionViewItem.bind(undefined, this.instantiationService),
			orientation: ActionsOrientation.HORIZONTAL,
		};
	}
	protected override _doLayout(_heightInPixel: number | undefined, _widthInPixel: number | undefined): void {
		// Reload the height with respect to the handleSolution text content and relayout it to match the line count.
		this.container!.style.height = 'initial';

		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const arrowHeight = Math.round(lineHeight / 3);
		const computedLinesNumber = Math.ceil((this.container!.offsetHeight + arrowHeight) / lineHeight);

		this._relayout(computedLinesNumber);
	}

	focus(): void {
		// Focus into the container for accessibility purposes so the handleSolution and stack trace gets read
		this.container?.focus();
	}

	hasFocus(): boolean {
		return dom.isAncestor(document.activeElement, this.container);
	}
}
