/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Color } from 'vs/base/common/color';
import { ThemeIcon } from 'vs/base/common/themables';
import 'vs/css!./media/exceptionWidget';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ZoneWidget } from 'vs/editor/contrib/zoneWidget/browser/zoneWidget';
import * as nls from 'vs/nls';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { widgetClose } from 'vs/platform/theme/common/iconRegistry';
import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { EDITOR_CONTRIBUTION_ID, IDebugEditorContribution } from 'vs/workbench/contrib/debug/common/debug';
const $ = dom.$;

// theming

const debugTriggerlessWidgetBorder = registerColor('debugTriggerlessWidget.border', { dark: '#a31515', light: '#a31515', hcDark: '#a31515', hcLight: '#a31515' }, nls.localize('debugTriggerlessWidgetBorder', 'Triggerless widget border color.'));
const debugTriggerlessWidgetBackground = registerColor('debugTriggerlessWidget.background', { dark: '#0b0b42', light: '#dedff1', hcDark: '#0d0b42', hcLight: '#dedff1' }, nls.localize('debugTriggerlessWidgetBackground', 'Triggerless widget background color.'));

export class TriggerlessWidget extends ZoneWidget {

	private backgroundColor: Color | undefined;

	constructor(
		editor: ICodeEditor,
		@IThemeService themeService: IThemeService,
	) {
		super(editor, { showFrame: true, showArrow: true, isAccessible: true, frameWidth: 1, className: 'triggerless-widget-container' });

		this.applyTheme(themeService.getColorTheme());
		this._disposables.add(themeService.onDidColorThemeChange(this.applyTheme.bind(this)));

		this.create();
		const onDidLayoutChangeScheduler = new RunOnceScheduler(() => this._doLayout(undefined, undefined), 50);
		this._disposables.add(this.editor.onDidLayoutChange(() => onDidLayoutChangeScheduler.schedule()));
		this._disposables.add(onDidLayoutChangeScheduler);
	}

	private applyTheme(theme: IColorTheme): void {
		this.backgroundColor = theme.getColor(debugTriggerlessWidgetBackground);
		const frameColor = theme.getColor(debugTriggerlessWidgetBorder);
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
		this.setCssClass('exception-widget');
		// Set the font size and line height to the one from the editor configuration.
		const fontInfo = this.editor.getOption(EditorOption.fontInfo);
		container.style.fontSize = `${fontInfo.fontSize}px`;
		container.style.lineHeight = `${fontInfo.lineHeight / 4}px`;
		container.tabIndex = 0;
		const title = $('.title');
		const label = $('.label');
		dom.append(title, label);
		const actions = $('.actions');
		dom.append(title, actions);
		label.textContent = nls.localize('exceptionThrown', 'Synthesizing...');
		const ariaLabel = label.textContent;

		const actionBar = new ActionBar(actions);
		actionBar.push(new Action('editor.closeTriggerlessWidget', nls.localize('close', "Close"), ThemeIcon.asClassName(widgetClose), true, async () => {
			const contribution = this.editor.getContribution<IDebugEditorContribution>(EDITOR_CONTRIBUTION_ID);
			contribution?.closeTriggerlessWidget();
		}), { label: false, icon: true });

		dom.append(container, title);

		// if (this.triggerlessInfo.description) {
		// 	const description = $('.description');
		// 	description.textContent = this.triggerlessInfo.description;
		// 	ariaLabel += ', ' + this.triggerlessInfo.description;
		// 	dom.append(container, description);
		// }

		container.setAttribute('aria-label', ariaLabel);
	}

	protected override _doLayout(_heightInPixel: number | undefined, _widthInPixel: number | undefined): void {
		// Reload the height with respect to the triggerless text content and relayout it to match the line count.
		this.container!.style.height = 'initial';

		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const arrowHeight = Math.round(lineHeight / 3);
		const computedLinesNumber = Math.ceil((this.container!.offsetHeight + arrowHeight) / lineHeight);

		this._relayout(computedLinesNumber);
	}

	focus(): void {
		// Focus into the container for accessibility purposes so the triggerless and stack trace gets read
		this.container?.focus();
	}

	hasFocus(): boolean {
		return dom.isAncestor(document.activeElement, this.container);
	}
}
