import { useEffect, useState } from 'react';
import { DropZone } from './components/DropZone';
import { ExtractPanel } from './components/ExtractPanel';
import { PwaBar } from './components/PwaBar';
import { useExtractor } from './state/useExtractor';

export function App() {
  const {
    state,
    engineCache,
    selectFile,
    setSelectedTrackIndex,
    setFormat,
    startExtraction,
    cancel,
    retry,
    backToOptions,
    reset,
  } = useExtractor();

  const [windowDragActive, setWindowDragActive] = useState(false);

  useEffect(() => {
    let dragDepth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragDepth += 1;
      setWindowDragActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
    };

    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setWindowDragActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepth = 0;
      setWindowDragActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        void selectFile(file);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [selectFile]);

  return (
    <div className="app-shell">
      <div className="app-container">
        <PwaBar engineCache={engineCache} />

        <main>
          {state.status === 'idle' ? (
            <DropZone onSelectFile={(file) => void selectFile(file)} />
          ) : (
            <ExtractPanel
              state={state}
              onSelectTrack={setSelectedTrackIndex}
              onSelectFormat={setFormat}
              onExtract={() => void startExtraction()}
              onCancel={cancel}
              onRetry={retry}
              onBackToOptions={backToOptions}
              onReset={reset}
            />
          )}
        </main>

        <footer className="app-footer">
          <p>Runs locally in WebAssembly. Your files stay on your device.</p>
          <p>Original stream copy · WAV · FLAC · MP3</p>
          <p>
            Made by <a href="https://shahidhussain.dev/">Shahid Hussain</a>
          </p>
        </footer>
      </div>

      {windowDragActive && state.status !== 'idle' && (
        <div className="drag-overlay" aria-hidden="true">
          <div className="drag-overlay-card">Drop video to inspect audio tracks</div>
        </div>
      )}
    </div>
  );
}
