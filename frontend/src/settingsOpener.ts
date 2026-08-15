/**
 * Opening the settings modal from anywhere, without threading a callback
 * through every panel.
 *
 * The modal's state lives in `MainPageActions` (the top bar owns it), but
 * "Manage content" in the Surprise card needs to open it on a particular tab.
 * One module-level registration is the same trick `flight.ts` uses, and it
 * keeps the app free of a context provider that would exist for one button.
 */
type Opener = (tab?: string) => void;

let opener: Opener | null = null;

export function registerSettingsOpener(fn: Opener | null): void {
  opener = fn;
}

export function openSettings(tab?: string): void {
  opener?.(tab);
}
