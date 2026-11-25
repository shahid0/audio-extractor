import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { UploadIcon } from './Icons';

interface DropZoneProps {
  readonly onSelectFile: (file: File) => void;
}

export function DropZone({ onSelectFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onSelectFile(file);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose a video file to extract audio from"
      className={`drop-zone ${isDragging ? 'drop-zone--active' : ''}`}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v,.ts,.flv,.3gp,.ogv,.wmv"
        onChange={handleChange}
      />

      <div className="drop-icon">
        <UploadIcon size={24} />
      </div>

      <h2 className="drop-heading">Drop a video or choose a file</h2>

      <p className="drop-copy">
        Copies the original audio stream without re-encoding, or converts to uncompressed WAV,
        FLAC, or 320 kbps MP3.
      </p>

      <span className="btn btn--primary" aria-hidden="true">
        Choose video
      </span>

      <p className="drop-meta">MP4 · MOV · MKV · WEBM · AVI · M4V · TS</p>
    </div>
  );
}
