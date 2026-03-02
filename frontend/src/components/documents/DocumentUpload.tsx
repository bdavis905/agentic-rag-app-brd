import { useCallback, useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Upload, FileUp, Info } from "lucide-react";
import { useOrg } from "@/hooks/useOrg";
import type { Id } from "@/types";

const ALLOWED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx"];

interface DocumentUploadProps {
  onUploadComplete: () => void;
  onSkipped?: () => void;
  folderId?: Id<"folders"> | null;
}

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function DocumentUpload({
  onUploadComplete,
  onSkipped,
  folderId,
}: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    type: "success" | "info";
  } | null>(null);

  const { activeOrgId } = useOrg();

  const generateUploadUrl = useMutation(
    api.documents.mutations.generateUploadUrl
  );
  const createDocument = useMutation(api.documents.mutations.create);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }
    if (file.size > 50 * 1024 * 1024) {
      return "File too large. Maximum size is 50 MB.";
    }
    return null;
  };

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setFeedback(null);
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        const validationError = validateFile(file);
        if (validationError) {
          setError(`${file.name}: ${validationError}`);
          return;
        }
      }

      setUploading(true);
      try {
        let allSkipped = true;
        for (const file of fileArray) {
          // Step 1: Get upload URL from Convex
          const uploadUrl = await generateUploadUrl();

          // Step 2: Upload file to Convex storage
          const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!uploadResponse.ok) {
            throw new Error(`Upload failed for ${file.name}`);
          }
          const { storageId } = await uploadResponse.json();

          // Step 3: Compute content hash for dedup
          const contentHash = await computeHash(file);

          // Step 4: Create document record
          const result = await createDocument({
            orgId: activeOrgId!,
            filename: file.name,
            fileType: file.type || "application/octet-stream",
            fileSize: file.size,
            storageId,
            folderId: folderId ?? undefined,
            contentHash,
          });

          if (result.action === "skipped") {
            setFeedback({
              message: `"${file.name}" already exists with identical content — processing skipped.`,
              type: "info",
            });
          } else {
            allSkipped = false;
            if (result.action === "updated") {
              setFeedback({
                message: `"${file.name}" updated, re-processing...`,
                type: "success",
              });
            } else {
              setFeedback({
                message: `"${file.name}" uploaded and processing...`,
                type: "success",
              });
            }
          }
        }
        if (allSkipped) {
          onSkipped?.();
        } else {
          onUploadComplete();
        }
      } catch (err) {
        console.error("[Upload] Error:", err);
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [folderId, onUploadComplete, onSkipped, generateUploadUrl, createDocument]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    },
    [handleUpload]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleUpload(e.target.files);
      }
    },
    [handleUpload]
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer group ${
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-border/50 hover:border-primary/50 hover:bg-muted/30"
        }`}
        onClick={() => document.getElementById("file-upload")?.click()}
      >
        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept=".txt,.md,.pdf,.docx"
          multiple
          onChange={handleFileInput}
        />
        <div className="space-y-3">
          <div
            className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging
                ? "bg-primary/20"
                : "bg-muted/50 group-hover:bg-primary/10"
            }`}
          >
            {uploading ? (
              <FileUp className="w-6 h-6 text-primary animate-bounce" />
            ) : (
              <Upload
                className={`w-6 h-6 transition-colors duration-300 ${
                  isDragging
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-primary"
                }`}
              />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {uploading ? "Uploading..." : "Drop files here or click to upload"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PDF, DOCX, TXT, MD (max 50 MB)
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 animate-fade-in ${
            feedback.type === "info"
              ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50"
              : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50"
          }`}
        >
          {feedback.type === "info" ? (
            <Info className="w-4 h-4 flex-shrink-0" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive animate-fade-in">
          <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
          {error}
        </div>
      )}
    </div>
  );
}
