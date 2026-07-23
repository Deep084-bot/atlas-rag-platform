import { useCallback, useEffect, useRef, useState } from 'react';

const PIPELINE_STAGES = [
  { id: 'extract', label: 'Extract', description: 'Parsing document content' },
  { id: 'chunk', label: 'Chunk', description: 'Splitting into passages' },
  { id: 'embed', label: 'Embed', description: 'Generating embeddings' },
  { id: 'index', label: 'Index', description: 'Storing in vector DB' },
];

export function UploadZone({ file, onFileChange, onUpload, isLoading, status, error }) {
  const [dragging, setDragging] = useState(false);
  const [activeStage, setActiveStage] = useState(-1);
  const dropRef = useRef(null);

  useEffect(() => {
    if (isLoading) {
      setActiveStage(0);
      const timers = [];
      for (let i = 1; i < PIPELINE_STAGES.length; i++) {
        const timer = setTimeout(() => setActiveStage(i), i * 1800);
        timers.push(timer);
      }
      return () => timers.forEach(clearTimeout);
    } else {
      setActiveStage(-1);
    }
  }, [isLoading]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    function handleDragEnter(e) {
      e.preventDefault();
      setDragging(true);
    }

    function handleDragOver(e) {
      e.preventDefault();
    }

    function handleDragLeave(e) {
      e.preventDefault();
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDragging(false);
    }

    function handleDrop(e) {
      e.preventDefault();
      setDragging(false);
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        const syntheticEvent = { target: { files: [droppedFile] } };
        onFileChange(syntheticEvent);
      }
    }

    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);

    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, [onFileChange]);

  const formatFileSize = useCallback((bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const getStageIcon = useCallback((idx) => {
    if (activeStage < idx) {
      return (
        <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    if (activeStage === idx) {
      return (
        <svg className="h-4 w-4 animate-spin text-atlas-teal" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      );
    }
    return (
      <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }, [activeStage]);

  return (
    <div
      ref={dropRef}
      className={`relative rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
        dragging
          ? 'border-atlas-teal/50 bg-atlas-teal/5'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      <input
        type="file"
        accept=".pdf,.txt,application/pdf,text/plain"
        onChange={onFileChange}
        className="absolute inset-0 cursor-pointer opacity-0"
        id="upload-input"
      />

      <div className="pointer-events-none">
        {file ? (
          <div className="text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-atlas-teal/20 bg-atlas-teal/10">
                <svg className="h-5 w-5 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{file.name}</p>
                <p className="text-xs text-slate-500">{file.type?.toUpperCase() || 'UNKNOWN'} • {formatFileSize(file.size)}</p>
              </div>
              <span className="rounded-full bg-atlas-teal/15 px-3 py-1 text-xs font-semibold text-atlas-teal">
                Selected
              </span>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <svg className="mx-auto mb-3 h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-slate-400">
              <span className="font-semibold text-slate-300">Click to upload</span> or drag and drop
            </p>
            <p className="mt-1 text-xs text-slate-500">PDF or TXT up to 25 MB</p>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="mt-4 space-y-2 rounded-xl border border-white/5 bg-slate-950/50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Processing Pipeline</p>
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage, idx) => (
              <div
                key={stage.id}
                className={`flex items-center gap-3 transition-opacity ${
                  idx <= activeStage ? 'opacity-100' : 'opacity-30'
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center">
                  {getStageIcon(idx)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${
                      idx <= activeStage ? 'text-slate-200' : 'text-slate-500'
                    }`}>
                      {stage.label}
                    </p>
                    {idx === activeStage && (
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-atlas-teal" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{stage.description}</p>
                </div>
                {idx < activeStage && (
                  <div className="h-0.5 w-12 rounded-full bg-emerald-400/50" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && file && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onUpload}
            disabled={isLoading}
            className="rounded-full bg-atlas-teal px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Upload
          </button>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
            status === 'idle' ? 'border-white/10 text-slate-400' :
            status === 'loading' ? 'border-atlas-teal/20 text-atlas-teal' :
            status === 'success' ? 'border-emerald-500/20 text-emerald-300' :
            status === 'error' ? 'border-rose-500/20 text-rose-200' :
            'border-white/10 text-slate-400'
          }`}>
            {status === 'idle' ? 'Ready' : status}
          </span>
        </div>
      )}

      {error && (
        <p className="mt-3 text-start text-sm text-rose-200">{error}</p>
      )}
    </div>
  );
}
