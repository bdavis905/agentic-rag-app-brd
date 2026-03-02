import { useState, useCallback } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  X,
  Folder,
  FileText,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  HardDrive,
  FolderInput,
  FileDown,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import type { Id } from "@/types";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  importable: boolean;
  exportInfo: { exportAs: string; extension: string } | null;
}

interface GoogleDriveImportProps {
  onClose: (navigateToFolderId?: string, folderName?: string) => void;
  targetFolderId?: Id<"folders"> | null;
}

type ImportMode = "files" | "folder";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(file: DriveFile) {
  if (file.isFolder) return <Folder className="w-4 h-4 text-blue-400" />;
  if (file.exportInfo) return <FileText className="w-4 h-4 text-blue-400" />;
  return <FileText className="w-4 h-4 text-muted-foreground" />;
}

export function GoogleDriveImport({
  onClose,
  targetFolderId,
}: GoogleDriveImportProps) {
  const { activeOrgId } = useOrg();
  const driveStatus = useQuery(api.googleDrive.queries.getConnectionStatus);
  const listDriveFolder = useAction(api.googleDrive.actions.listDriveFolder);
  const importFilesAction = useAction(api.googleDrive.actions.importFiles);
  const importFolderAction = useAction(api.googleDrive.actions.importFolder);

  const [mode, setMode] = useState<ImportMode>("files");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [breadcrumbs, setBreadcrumbs] = useState<
    { id: string | null; name: string }[]
  >([{ id: null, name: "My Drive" }]);

  const canGoBack = breadcrumbs.length > 1;

  const loadFolder = useCallback(
    async (folderId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listDriveFolder({
          folderId: folderId ?? undefined,
        });
        setFiles(result);
        setSelectedIds(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Drive");
      } finally {
        setLoading(false);
      }
    },
    [listDriveFolder]
  );

  // Load root on first render
  const [loaded, setLoaded] = useState(false);
  if (!loaded && driveStatus?.connected) {
    setLoaded(true);
    loadFolder(null);
  }

  const navigateToFolder = (folderId: string, folderName: string) => {
    setBreadcrumbs((prev) => [...prev, { id: folderId, name: folderName }]);
    loadFolder(folderId);
  };

  const navigateBack = () => {
    if (breadcrumbs.length <= 1) return;
    const parentCrumb = breadcrumbs[breadcrumbs.length - 2];
    setBreadcrumbs((prev) => prev.slice(0, -1));
    loadFolder(parentCrumb.id);
  };

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index];
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    loadFolder(crumb.id);
  };

  const toggleSelection = (fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      if (mode === "files") {
        const selectedFiles = files.filter(
          (f) => selectedIds.has(f.id) && !f.isFolder
        );
        if (selectedFiles.length === 0) return;

        await importFilesAction({
          orgId: activeOrgId!,
          files: selectedFiles.map((f) => ({
            driveFileId: f.id,
            driveName: f.name,
            driveMimeType: f.mimeType,
            driveModifiedTime: f.modifiedTime ?? undefined,
          })),
          targetFolderId: targetFolderId ?? undefined,
        });
      } else {
        // Folder mode — import selected folders
        const selectedFolders = files.filter(
          (f) => selectedIds.has(f.id) && f.isFolder
        );
        if (selectedFolders.length === 0) return;

        let lastFolderId: string | undefined;
        let lastFolderName: string | undefined;
        for (const folder of selectedFolders) {
          const result = await importFolderAction({
            orgId: activeOrgId!,
            driveFolderId: folder.id,
            driveFolderName: folder.name,
            targetParentFolderId: targetFolderId ?? undefined,
          });
          lastFolderId = result.folderId;
          lastFolderName = folder.name;
        }

        // Navigate into the imported folder (last one if multiple)
        if (lastFolderId) {
          onClose(lastFolderId, lastFolderName);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Not configured or not connected state
  if (driveStatus !== undefined && !driveStatus?.connected) {
    const message = !driveStatus?.configured
      ? "Configure your Google Drive credentials in Settings first, then connect."
      : "Connect your Google Drive in Settings to import documents.";

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={() => onClose()} />
        <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Import from Google Drive</h2>
            <button
              onClick={() => onClose()}
              className="p-1 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-muted/50 flex items-center justify-center">
              <HardDrive className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                window.location.href = "/settings";
              }}
            >
              Go to Settings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedFileCount = Array.from(selectedIds).filter((id) =>
    files.some((f) => f.id === id && !f.isFolder)
  ).length;

  const selectedFolderCount = Array.from(selectedIds).filter((id) =>
    files.some((f) => f.id === id && f.isFolder)
  ).length;

  const selectedCount = mode === "files" ? selectedFileCount : selectedFolderCount;

  const folderCount = files.filter((f) => f.isFolder).length;
  const fileCount = files.filter((f) => !f.isFolder).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose()} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-2xl mx-4 shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h2 className="text-lg font-semibold">Import from Google Drive</h2>
          <button
            onClick={() => onClose()}
            className="p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
            <button
              onClick={() => {
                setMode("files");
                setSelectedIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                mode === "files"
                  ? "font-medium bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileDown className="w-3.5 h-3.5" />
              Pick Files
            </button>
            <button
              onClick={() => {
                setMode("folder");
                setSelectedIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                mode === "folder"
                  ? "font-medium bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FolderInput className="w-3.5 h-3.5" />
              Import Folder
            </button>
          </div>
        </div>

        {/* Navigation bar: back button + breadcrumbs */}
        <div className="px-4 py-2 flex items-center gap-2 border-b border-border/30">
          <button
            onClick={navigateBack}
            disabled={!canGoBack || loading}
            className={`p-1 rounded-md transition-colors shrink-0 ${
              canGoBack
                ? "hover:bg-muted text-foreground"
                : "text-muted-foreground/30 cursor-default"
            }`}
            title="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1 text-sm overflow-x-auto">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                )}
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  disabled={loading}
                  className={`hover:text-foreground transition-colors ${
                    i === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:underline"
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-auto px-4 py-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading...
              </span>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm text-muted-foreground">
                No importable files in this folder.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Only documents are shown (PDF, DOCX, TXT, MD, Google Docs).
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {files.map((file) => {
                // File mode: files selectable, folders navigate on click
                // Folder mode: folders selectable on click, navigate via arrow
                const isSelectable =
                  mode === "files" ? !file.isFolder : file.isFolder;
                const isSelected = isSelectable && selectedIds.has(file.id);

                return (
                  <div
                    key={file.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                    onClick={() => {
                      if (file.isFolder && mode === "files") {
                        // File mode: clicking a folder navigates into it
                        navigateToFolder(file.id, file.name);
                      } else if (isSelectable) {
                        // Select/deselect
                        toggleSelection(file.id);
                      }
                    }}
                  >
                    {/* Checkbox for selectable items */}
                    {isSelectable ? (
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {isSelected && (
                          <Check className="w-3 h-3 text-primary-foreground" />
                        )}
                      </div>
                    ) : (
                      <div className="w-4 shrink-0" />
                    )}

                    {getFileIcon(file)}

                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {file.name}
                        {file.exportInfo && (
                          <span className="text-xs text-muted-foreground ml-1">
                            → {file.exportInfo.extension}
                          </span>
                        )}
                      </div>
                      {!file.isFolder && file.size !== null && (
                        <div className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </div>
                      )}
                    </div>

                    {/* Navigate arrow for folders — always shown so you can drill in */}
                    {file.isFolder && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToFolder(file.id, file.name);
                        }}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0"
                        title="Open folder"
                      >
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border/50">
          <div className="text-xs text-muted-foreground">
            {loading
              ? ""
              : selectedCount > 0
                ? `${selectedCount} ${mode === "files" ? "file" : "folder"}${selectedCount > 1 ? "s" : ""} selected`
                : mode === "files"
                  ? `${folderCount} folder${folderCount !== 1 ? "s" : ""}${fileCount > 0 ? `, ${fileCount} file${fileCount !== 1 ? "s" : ""}` : ""}`
                  : "Select folders to import, or use → to browse inside"}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={selectedCount === 0 || importing}
            >
              {importing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Importing...
                </>
              ) : (
                <>Import{selectedCount > 0 && ` (${selectedCount})`}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
