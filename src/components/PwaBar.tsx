import { useEffect, useState } from 'react';
import type { EngineCacheState } from '../state/useExtractor';
import { WaveformIcon } from './Icons';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaBarProps {
  readonly engineCache: EngineCacheState;
}

export function PwaBar({ engineCache }: PwaBarProps) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') {
      setInstallEvent(null);
    }
  };

  let statusLabel = 'Local WASM engine';
  let dotClass = 'status-dot';
  if (engineCache === 'loading') {
    statusLabel = 'Loading engine';
    dotClass = 'status-dot status-dot--loading';
  } else if (engineCache === 'ready') {
    statusLabel = isOnline ? 'Ready offline' : 'Offline · Ready';
    dotClass = 'status-dot status-dot--ready';
  } else if (!isOnline) {
    statusLabel = 'Offline';
  }

  return (
    <header className="top-bar">
      <div className="brand">
        <div className="brand-mark">
          <WaveformIcon size={20} />
        </div>
        <div>
          <h1 className="brand-title">Audio Extractor</h1>
          <p className="brand-sub">Lossless audio from video, on your device</p>
        </div>
      </div>

      <div className="top-actions">
        <span className="status-pill" aria-live="polite">
          <span className={dotClass} aria-hidden="true" />
          {statusLabel}
        </span>

        {installEvent && (
          <button type="button" className="btn btn--ghost" onClick={handleInstall}>
            Install app
          </button>
        )}
      </div>
    </header>
  );
}
