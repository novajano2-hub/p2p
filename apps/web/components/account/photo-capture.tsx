"use client";

import {
  ArrowsClockwise,
  Camera,
  CheckCircle,
  FolderOpen,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient, type KycDocumentKind } from "@/lib/auth/client";
import { cn } from "@/lib/cn";
import { prepareImage } from "@/lib/image";

/*
  One photograph: take it, watch it go up, look at it, take it again if it
  is no good. The upload starts the moment a picture is chosen, so by the
  time the person reaches the end nothing is left to wait for, and a bad
  connection costs one photo rather than the whole application.

  Two hidden file inputs rather than one. On a phone, `capture` opens the
  camera straight away with no gallery in between - which is what a document
  photo wants - but it also means a scan already on the phone cannot be
  chosen, so a second input without it stands beside the first. On a desktop
  both open the same file dialog, which is fine.
*/

export type CapturedPhoto = { id: string; kind: KycDocumentKind; previewUrl: string };

type Progress =
  | { status: "idle" }
  | { status: "uploading"; previewUrl: string; fraction: number }
  | { status: "failed"; message: string };

type PhotoCaptureProps = {
  kind: KycDocumentKind;
  title: string;
  hint: string;
  /** Which camera a phone opens: the back one for a document, the front one for a face. */
  facing: "environment" | "user";
  value: CapturedPhoto | null;
  onChange: (photo: CapturedPhoto) => void;
};

export function PhotoCapture({ kind, title, hint, facing, value, onChange }: PhotoCaptureProps) {
  const [progress, setProgress] = useState<Progress>({ status: "idle" });
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still counts as a change.
    event.target.value = "";
    if (!file) return;

    const image = await prepareImage(file);
    const previewUrl = URL.createObjectURL(image);
    setProgress({ status: "uploading", previewUrl, fraction: 0 });

    const result = await authClient.uploadKycDocument({
      kind,
      file: image,
      onProgress: (fraction) => setProgress({ status: "uploading", previewUrl, fraction }),
    });
    if (!result.ok) {
      URL.revokeObjectURL(previewUrl);
      setProgress({ status: "failed", message: result.message });
      return;
    }
    setProgress({ status: "idle" });
    onChange({ id: result.document.id, kind, previewUrl });
  };

  const uploading = progress.status === "uploading";
  const preview = progress.status === "uploading" ? progress.previewUrl : value?.previewUrl;

  return (
    <div className="rounded-surface border-border bg-surface flex flex-col gap-4 border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-foreground text-[15px] font-medium">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">{hint}</p>
        </div>
        {value && !uploading ? (
          <span className="bg-status-complete text-status-complete-fg inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap">
            <CheckCircle size={14} weight="fill" aria-hidden="true" />
            Added
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-control bg-muted relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden",
          !preview && "border-border border border-dashed",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from this device; there is nothing for the image optimiser to fetch
          <img
            src={preview}
            alt={value && !uploading ? `${title}, as uploaded` : ""}
            className={cn("size-full object-cover", uploading && "opacity-60")}
          />
        ) : (
          <span className="text-muted-foreground flex flex-col items-center gap-2 text-[13px]">
            <Camera size={28} weight="duotone" aria-hidden="true" />
            No photo yet
          </span>
        )}

        {uploading ? (
          <div
            role="progressbar"
            aria-label={`Uploading ${title.toLowerCase()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
            className="bg-surface/90 absolute inset-x-3 bottom-3 rounded-full p-1"
          >
            <div className="bg-border h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-150 ease-out"
                style={{ width: `${Math.max(4, Math.round(progress.fraction * 100))}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {progress.status === "failed" ? (
        <p
          role="alert"
          className="text-status-attention-fg flex items-start gap-2 text-[13px] leading-relaxed"
        >
          <WarningCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
          {progress.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={value ? "secondary" : "primary"}
          disabled={uploading}
          onClick={() => cameraInput.current?.click()}
        >
          {value ? (
            <ArrowsClockwise size={15} weight="bold" aria-hidden="true" />
          ) : (
            <Camera size={15} weight="bold" aria-hidden="true" />
          )}
          {value ? "Retake" : "Take a photo"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <FolderOpen size={15} weight="bold" aria-hidden="true" />
          Choose a file
        </Button>
      </div>

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture={facing}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => void onFile(event)}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => void onFile(event)}
      />
    </div>
  );
}
