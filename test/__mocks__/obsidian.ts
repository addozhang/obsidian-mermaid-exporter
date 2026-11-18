export class Plugin {
	app: unknown;
	private postProcessors: Array<(el: HTMLElement, ctx: unknown) => void> = [];
	private intervals: number[] = [];

	constructor(app: unknown) {
		this.app = app;
	}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(): Promise<void> {}
	addSettingTab(): void {}
	registerEditorExtension(): void {}
	registerMarkdownPostProcessor(cb: (el: HTMLElement, ctx: unknown) => void): void {
		this.postProcessors.push(cb);
	}
	registerInterval(id: number): number {
		this.intervals.push(id);
		return id;
	}
	registerDomEvent(
		el: HTMLElement,
		type: string,
		cb: EventListenerOrEventListenerObject,
	): void {
		el.addEventListener(type, cb);
	}
	_getPostProcessors() {
		return this.postProcessors;
	}
}

export class PluginSettingTab {
	containerEl = document.createElement("div");
	constructor() {}
}

export class Setting {
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	addSlider() {
		return this;
	}
	addDropdown() {
		return this;
	}
}

export class Notice {
	constructor(public message: string) {}
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}
