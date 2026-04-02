import { describe, expect, it, vi } from 'vitest';
import {
  applyStartupUpdaterSettings,
  STARTUP_UPDATE_CHECK_DELAY_MS,
  type StartupUpdater,
} from '../../electron/main/updater-startup';

describe('startup updater settings', () => {
  it('applies auto-download immediately and schedules startup check when enabled', async () => {
    const updater: StartupUpdater = {
      setAutoDownload: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
    };
    let scheduledCallback: (() => void) | null = null;
    const schedule = vi.fn((callback: () => void, _delayMs: number) => {
      scheduledCallback = callback;
      return 1;
    });

    applyStartupUpdaterSettings(
      updater,
      {
        autoCheckUpdate: true,
        autoDownloadUpdate: true,
      },
      { schedule },
    );

    expect(updater.setAutoDownload).toHaveBeenCalledWith(true);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), STARTUP_UPDATE_CHECK_DELAY_MS);

    await scheduledCallback?.();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a startup check when auto-check is disabled', () => {
    const updater: StartupUpdater = {
      setAutoDownload: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
    };
    const schedule = vi.fn();

    applyStartupUpdaterSettings(
      updater,
      {
        autoCheckUpdate: false,
        autoDownloadUpdate: false,
      },
      { schedule },
    );

    expect(updater.setAutoDownload).toHaveBeenCalledWith(false);
    expect(schedule).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('forwards startup check errors to the provided handler', async () => {
    const error = new Error('boom');
    const updater: StartupUpdater = {
      setAutoDownload: vi.fn(),
      checkForUpdates: vi.fn().mockRejectedValue(error),
    };
    let scheduledCallback: (() => void) | null = null;
    const onCheckError = vi.fn();

    applyStartupUpdaterSettings(
      updater,
      {
        autoCheckUpdate: true,
        autoDownloadUpdate: false,
      },
      {
        schedule: (callback) => {
          scheduledCallback = callback;
          return 1;
        },
        onCheckError,
      },
    );

    await scheduledCallback?.();
    expect(onCheckError).toHaveBeenCalledWith(error);
  });
});
