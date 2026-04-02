export interface StartupUpdateSettings {
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
}

export interface StartupUpdater {
  setAutoDownload(enable: boolean): void;
  checkForUpdates(): Promise<unknown>;
}

export const STARTUP_UPDATE_CHECK_DELAY_MS = 10_000;

type StartupUpdateScheduler = (callback: () => void, delayMs: number) => unknown;

interface ApplyStartupUpdaterSettingsOptions {
  delayMs?: number;
  schedule?: StartupUpdateScheduler;
  onCheckError?: (error: unknown) => void;
}

function scheduleStartupUpdateCheck(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(callback, delayMs);
}

export function applyStartupUpdaterSettings(
  updater: StartupUpdater,
  settings: StartupUpdateSettings,
  options: ApplyStartupUpdaterSettingsOptions = {},
): void {
  const {
    delayMs = STARTUP_UPDATE_CHECK_DELAY_MS,
    schedule = scheduleStartupUpdateCheck,
    onCheckError,
  } = options;

  updater.setAutoDownload(settings.autoDownloadUpdate);

  if (!settings.autoCheckUpdate) {
    return;
  }

  schedule(() => {
    void updater.checkForUpdates().catch((error) => {
      onCheckError?.(error);
    });
  }, delayMs);
}
