import { useState } from 'react';
import {
  buildFormatOptions,
  formatBytes,
  formatDuration,
  formatTrackLabel,
  formatTrackSpecs,
  type OutputFormatId,
} from '../domain/audioFormats';
import type { ExtractorState } from '../state/useExtractor';
import { AlertIcon, CheckIcon, DownloadIcon, ShareIcon } from './Icons';

interface ExtractPanelProps {
  readonly state: Exclude<ExtractorState, { status: 'idle' }>;
  readonly onSelectTrack: (trackIndex: number) => void;
  readonly onSelectFormat: (format: OutputFormatId) => void;
  readonly onExtract: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onBackToOptions: () => void;
  readonly onReset: () => void;
}

function canShareFile(blob: Blob, fileName: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const file = new File([blob], fileName, { type: blob.type });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function ExtractPanel({
  state,
  onSelectTrack,
  onSelectFormat,
  onExtract,
  onCancel,
  onRetry,
  onBackToOptions,
  onReset,
}: ExtractPanelProps) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);

  if (state.status === 'inspecting') {
    const loadingEngine = state.engineProgress < 1;
    const pct = Math.round(state.engineProgress * 100);

    return (
      <section className="panel" aria-live="polite">
        <div className="file-header">
          <div className="file-info">
            <h2 className="file-name">{state.file.name}</h2>
            <p className="file-meta">{formatBytes(state.file.size)}</p>
          </div>
        </div>

        <div className="progress-block">
          <div className="progress-row">
            <span className="progress-label">
              {loadingEngine ? 'Loading WebAssembly audio engine' : 'Reading audio tracks'}
            </span>
            {loadingEngine && <span className="progress-pct">{pct}%</span>}
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={loadingEngine ? pct : undefined}
          >
            <div
              className={`progress-fill ${loadingEngine ? '' : 'progress-fill--indeterminate'}`}
              style={loadingEngine ? { width: `${Math.max(4, pct)}%` } : undefined}
            />
          </div>

          <p className="progress-note">
            {loadingEngine
              ? 'Downloaded once and cached on this device for offline use.'
              : 'Inspecting container streams locally.'}
          </p>
        </div>

        <div className="actions-row">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="panel" aria-live="assertive">
        {state.file && (
          <div className="file-header">
            <div className="file-info">
              <h2 className="file-name">{state.file.name}</h2>
              <p className="file-meta">{formatBytes(state.file.size)}</p>
            </div>
          </div>
        )}

        <div className="error-box" role="alert">
          <span className="error-icon">
            <AlertIcon size={20} />
          </span>
          <p className="error-text">{state.message}</p>
        </div>

        <div className="actions-row">
          {state.canRetry && (
            <button type="button" className="btn btn--primary" onClick={onRetry}>
              Try again
            </button>
          )}
          {state.readyFallback && (
            <button type="button" className="btn btn--secondary" onClick={onBackToOptions}>
              Change format
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onReset}>
            Choose another video
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'ready') {
    const { file, probe, selectedTrackIndex, format } = state.data;
    const track = probe.tracks[selectedTrackIndex] ?? probe.tracks[0];
    if (!track) return null;

    const options = buildFormatOptions(track);

    return (
      <section className="panel">
        <div className="file-header">
          <div className="file-info">
            <h2 className="file-name">{file.name}</h2>
            <p className="file-meta">
              {formatDuration(probe.durationSec)} · {formatBytes(file.size)} ·{' '}
              {probe.tracks.length === 1
                ? '1 audio track'
                : `${probe.tracks.length} audio tracks`}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Change file
          </button>
        </div>

        <div className="section-group">
          <label className="section-label" htmlFor="audio-track-select">
            Source audio
          </label>
          {probe.tracks.length > 1 ? (
            <select
              id="audio-track-select"
              className="track-select"
              value={selectedTrackIndex}
              onChange={(e) => onSelectTrack(Number(e.target.value))}
            >
              {probe.tracks.map((item, idx) => (
                <option key={item.streamSpec} value={idx}>
                  {formatTrackLabel(item, idx)}
                </option>
              ))}
            </select>
          ) : (
            <div className="track-summary">{formatTrackSpecs(track)}</div>
          )}
        </div>

        <fieldset className="section-group">
          <legend className="section-label">Output format</legend>
          <div className="format-grid" role="radiogroup" aria-label="Output audio format">
            {options.map((opt) => {
              const selected = opt.id === format;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`format-card ${selected ? 'format-card--selected' : ''}`}
                  onClick={() => onSelectFormat(opt.id)}
                >
                  <span className="format-card-top">
                    <span className="format-title">{opt.label}</span>
                    <span className="format-ext">.{opt.extension}</span>
                  </span>
                  <span className="format-detail">{opt.detail}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="actions-row">
          <button type="button" className="btn btn--primary" onClick={onExtract}>
            Extract audio
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'extracting') {
    const { file, probe, selectedTrackIndex, format } = state.data;
    const track = probe.tracks[selectedTrackIndex] ?? probe.tracks[0];
    const pct = Math.round(state.progress * 100);
    const hasProgress = state.progress > 0;
    const actionLabel =
      format === 'original'
        ? `Copying ${track?.codecDisplay ?? 'original'} stream`
        : `Converting to ${format.toUpperCase()}`;

    return (
      <section className="panel" aria-live="polite">
        <div className="file-header">
          <div className="file-info">
            <h2 className="file-name">{file.name}</h2>
            <p className="file-meta">
              {formatDuration(probe.durationSec)} · {formatBytes(file.size)}
            </p>
          </div>
        </div>

        <div className="progress-block">
          <div className="progress-row">
            <span className="progress-label">{actionLabel}</span>
            {hasProgress && <span className="progress-pct">{pct}%</span>}
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hasProgress ? pct : undefined}
          >
            <div
              className={`progress-fill ${hasProgress ? '' : 'progress-fill--indeterminate'}`}
              style={hasProgress ? { width: `${Math.max(4, pct)}%` } : undefined}
            />
          </div>

          <p className="progress-note">
            {format === 'original'
              ? 'Stream copy keeps every original audio bit intact.'
              : 'Processing audio locally with WebAssembly.'}
          </p>
        </div>

        <div className="actions-row">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  // state.status === 'done'
  const { data } = state;
  const selectedTrack = data.probe.tracks[data.selectedTrackIndex];
  const elapsedLabel =
    data.elapsedMs < 1000
      ? `${data.elapsedMs} ms`
      : `${(data.elapsedMs / 1000).toFixed(1)} s`;
  const shareSupported = canShareFile(data.blob, data.plan.downloadFileName);

  const handleShare = async () => {
    try {
      const shareFile = new File([data.blob], data.plan.downloadFileName, {
        type: data.blob.type,
      });
      await navigator.share({
        files: [shareFile],
        title: data.plan.downloadFileName,
      });
    } catch {
      // User dismissed share sheet; ignore
    }
  };

  return (
    <section className="panel" aria-live="polite">
      <div className="file-header">
        <div className="file-info">
          <span
            className={`badge ${data.plan.isLossless ? 'badge--lossless' : 'badge--lossy'}`}
          >
            <CheckIcon size={14} />
            {data.plan.qualityBadge}
          </span>
          <h2 className="file-name">{data.plan.downloadFileName}</h2>
          <p className="file-meta">
            {formatBytes(data.sizeBytes)} · {formatDuration(data.probe.durationSec)} · done in{' '}
            {elapsedLabel}
          </p>
        </div>
      </div>

      <div className="result-box">
        <div className="result-top">
          <p className="result-filename">Preview</p>
          <p className="result-stats">
            {selectedTrack ? formatTrackSpecs(selectedTrack) : ''}
          </p>
        </div>

        {failedPreviewUrl !== data.audioUrl ? (
          <audio
            key={data.audioUrl}
            className="audio-player"
            controls
            preload="metadata"
            src={data.audioUrl}
            onError={() => setFailedPreviewUrl(data.audioUrl)}
          />
        ) : (
          <p className="player-fallback-note">
            This browser cannot play .{data.plan.extension} inline, but the downloaded file is
            intact.
          </p>
        )}
      </div>

      <div className="actions-row">
        <a
          className="btn btn--primary"
          href={data.audioUrl}
          download={data.plan.downloadFileName}
        >
          <DownloadIcon size={18} />
          Download audio
        </a>

        {shareSupported && (
          <button type="button" className="btn btn--secondary" onClick={handleShare}>
            <ShareIcon size={18} />
            Share
          </button>
        )}
      </div>

      <div className="actions-row">
        <button type="button" className="btn btn--ghost" onClick={onBackToOptions}>
          Change format
        </button>
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Extract another
        </button>
      </div>
    </section>
  );
}
