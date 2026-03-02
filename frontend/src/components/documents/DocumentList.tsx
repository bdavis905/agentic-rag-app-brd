import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { useOrg } from "@/hooks/useOrg";
import { api } from "../../../convex/_generated/api";
import type { ConvexDocument, ConvexFolder } from "@/types";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  FolderIcon,
  FileText,
  FileType,
  FileSpreadsheet,
  FileImage,
  File,
  X,
  Pencil,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface DocumentListProps {
  folders: ConvexFolder[];
  documents: ConvexDocument[];
  loading: boolean;
  onSelectFolder: (folderId: string | null, folderName: string | null) => void;
}

type SortOption = "uploaded_desc" | "name_asc" | "name_desc";
type StatusFilter = "all" | "completed" | "processing" | "failed";
type FileTypeFilter = "all" | "pdf" | "word" | "excel" | "image" | "text";

function StatusBadge({ status }: { status: "pending" | "processing" | "completed" | "failed" }) {
  const styles = {
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    processing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeIcon(fileType: string | undefined) {
  const type = (fileType || "").toLowerCase();
  if (type.includes("pdf")) return FileType;
  if (type.includes("word") || type.includes("document")) return FileText;
  if (type.includes("excel") || type.includes("spreadsheet"))
    return FileSpreadsheet;
  if (
    type.includes("image") ||
    type.includes("png") ||
    type.includes("jpg") ||
    type.includes("jpeg")
  )
    return FileImage;
  if (type.includes("text") || type.includes("markdown")) return FileText;
  return File;
}

function getFileTypeCategory(fileType: string | undefined): FileTypeFilter {
  const type = (fileType || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("word") || type.includes("document")) return "word";
  if (type.includes("excel") || type.includes("spreadsheet")) return "excel";
  if (
    type.includes("image") ||
    type.includes("png") ||
    type.includes("jpg") ||
    type.includes("jpeg")
  )
    return "image";
  if (type.includes("text") || type.includes("markdown")) return "text";
  return "all";
}

function MetadataValue({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary border border-primary/20"
          >
            {String(v)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "boolean") {
    return <span className="text-sm">{value ? "Yes" : "No"}</span>;
  }

  if (typeof value === "number") {
    return <span className="text-sm">{value.toLocaleString()}</span>;
  }

  const strVal = String(value);
  if (strVal.length <= 30 && fieldKey === "document_type") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-500/15 text-violet-400 border border-violet-500/20">
        {strVal}
      </span>
    );
  }

  return <span className="text-sm text-foreground">{strVal}</span>;
}

function MetadataPanel({ metadata }: { metadata: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No metadata extracted
      </p>
    );
  }

  const extractionError = metadata._extractionError as string | undefined;

  const orderedKeys = Object.keys(metadata)
    .filter((k) => !k.startsWith("_"))
    .sort((a, b) => {
      if (a === "title") return -1;
      if (b === "title") return 1;
      if (a === "summary") return -1;
      if (b === "summary") return 1;
      return a.localeCompare(b);
    });

  return (
    <div className="space-y-4">
      {extractionError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              Metadata extraction failed
            </p>
            <p className="text-xs text-amber-400/80 mt-1">{extractionError}</p>
          </div>
        </div>
      )}
      {orderedKeys.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {key.replace(/_/g, " ")}
          </span>
          <MetadataValue fieldKey={key} value={metadata[key]} />
        </div>
      ))}
    </div>
  );
}

export function DocumentList({
  folders = [],
  documents = [],
  loading,
  onSelectFolder,
}: DocumentListProps) {
  const { activeOrgId } = useOrg();
  const removeDocument = useMutation(api.documents.mutations.remove);
  const renameDocument = useMutation(api.documents.mutations.rename);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<ConvexDocument | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("uploaded_desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fileTypeFilter, setFileTypeFilter] =
    useState<FileTypeFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (doc: ConvexDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentTitle = (doc.metadata as any)?.title || doc.filename;
    setEditTitle(currentTitle);
    setEditingId(doc._id);
  };

  const saveTitle = async (docId: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      try {
        await renameDocument({ orgId: activeOrgId!, documentId: docId as any, title: trimmed });
      } catch (error) {
        console.error("Failed to rename document:", error);
      }
    }
    setEditingId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const handleDelete = async (doc: ConvexDocument) => {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;

    setDeletingId(doc._id);
    try {
      await removeDocument({ orgId: activeOrgId!, documentId: doc._id });
    } catch (error) {
      console.error("Failed to delete document:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const openDetails = (doc: ConvexDocument) => {
    if (doc.status !== "completed") return;
    setSelectedDoc(doc);
  };

  const filteredAndSortedDocs = useMemo(() => {
    let filtered = documents;

    if (statusFilter !== "all") {
      filtered = filtered.filter((doc) => doc.status === statusFilter);
    }

    if (fileTypeFilter !== "all") {
      filtered = filtered.filter(
        (doc) => getFileTypeCategory(doc.fileType) === fileTypeFilter
      );
    }

    const sorted = [...filtered];
    switch (sortBy) {
      case "uploaded_desc":
        sorted.sort((a, b) => b._creationTime - a._creationTime);
        break;
      case "name_asc":
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case "name_desc":
        sorted.sort((a, b) => b.filename.localeCompare(a.filename));
        break;
    }

    return sorted;
  }, [documents, sortBy, statusFilter, fileTypeFilter]);

  if (loading && documents.length === 0 && folders.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  const hasFilters = statusFilter !== "all" || fileTypeFilter !== "all";
  const hasDocuments = documents.length > 0;
  const hasFolders = folders.length > 0;
  const isEmpty = !hasFolders && filteredAndSortedDocs.length === 0;

  if (isEmpty && !loading && !hasFilters) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        This folder is empty.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Folders section */}
      {folders.length > 0 && (
        <div className="space-y-0.5">
          {folders.map((folder) => (
            <div
              key={folder._id}
              onClick={() => onSelectFolder(folder._id, folder.name)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <FolderIcon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate">{folder.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      {(hasDocuments || hasFilters) && (
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">
              Sort:
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 text-sm border border-border/50 rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
            >
              <option value="uploaded_desc">Date Uploaded</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">
              Status:
            </label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as StatusFilter)
              }
              className="px-3 py-1.5 text-sm border border-border/50 rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">
              Type:
            </label>
            <select
              value={fileTypeFilter}
              onChange={(e) =>
                setFileTypeFilter(e.target.value as FileTypeFilter)
              }
              className="px-3 py-1.5 text-sm border border-border/50 rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
            >
              <option value="all">All</option>
              <option value="pdf">PDF</option>
              <option value="word">Word</option>
              <option value="text">Text</option>
            </select>
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter("all");
                setFileTypeFilter("all");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Documents List */}
      {filteredAndSortedDocs.length > 0 ? (
        <div className="border border-border/50 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground border-b border-border/30">
            <span>Name</span>
            <span className="w-20 text-right">Size</span>
            <span className="w-16 text-right">Chunks</span>
            <span className="w-24 text-center">Status</span>
            <span className="w-8" />
          </div>
          {/* Rows */}
          <div className="divide-y divide-border/20">
            {filteredAndSortedDocs.map((doc) => {
              const IconComponent = getFileTypeIcon(doc.fileType);
              const displayName = (doc.metadata as any)?.title || doc.filename;
              return (
                <div
                  key={doc._id}
                  onClick={() => openDetails(doc)}
                  className={`group grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2.5 items-center transition-colors ${
                    doc.status === "completed"
                      ? "cursor-pointer hover:bg-muted/30"
                      : ""
                  }`}
                >
                  {/* Name */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IconComponent className="w-4 h-4 text-muted-foreground shrink-0" />
                    {editingId === doc._id ? (
                      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(doc._id);
                            if (e.key === "Escape") cancelEditing();
                          }}
                          onBlur={() => saveTitle(doc._id)}
                          className="w-full text-sm bg-transparent border-b border-primary outline-none"
                        />
                      </div>
                    ) : (
                      <>
                        <span className="text-sm truncate" title={displayName}>
                          {displayName}
                        </span>
                        <button
                          onClick={(e) => startEditing(doc, e)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                          title="Rename"
                        >
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </>
                    )}
                    {doc.status === "processing" && (doc as any).processingStep && (
                      <span className="flex items-center gap-1 text-xs text-blue-400 shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {(doc as any).processingStep}
                      </span>
                    )}
                  </div>

                  {/* Size */}
                  <span className="w-20 text-right text-xs text-muted-foreground">
                    {formatFileSize(doc.fileSize)}
                  </span>

                  {/* Chunks */}
                  <span className="w-16 text-right text-xs text-muted-foreground">
                    {doc.status === "completed" ? doc.chunkCount : "—"}
                  </span>

                  {/* Status */}
                  <div className="w-24 flex justify-center">
                    <StatusBadge status={doc.status} />
                  </div>

                  {/* Delete */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc);
                    }}
                    disabled={deletingId === doc._id}
                    className="w-8 flex justify-center opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                    title="Delete"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : hasFilters ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No documents match the current filters.
        </p>
      ) : null}

      {/* Document Details Modal */}
      {selectedDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSelectedDoc(null)}
          />
          <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[80vh] overflow-auto">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                  {(() => {
                    const IconComponent = getFileTypeIcon(
                      selectedDoc.fileType
                    );
                    return (
                      <IconComponent className="w-6 h-6 text-muted-foreground" />
                    );
                  })()}
                </div>
                <div className="min-w-0">
                  {editingId === selectedDoc._id ? (
                    <div className="flex items-center gap-2">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveTitle(selectedDoc._id);
                          if (e.key === "Escape") cancelEditing();
                        }}
                        onBlur={() => saveTitle(selectedDoc._id)}
                        className="text-lg font-semibold bg-transparent border-b border-primary outline-none w-full"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold truncate">
                        {(selectedDoc.metadata as any)?.title ||
                          selectedDoc.filename}
                      </h2>
                      <button
                        onClick={(e) => startEditing(selectedDoc, e)}
                        className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground truncate">
                    {selectedDoc.filename}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDoc(null)}
                className="p-1 rounded-lg hover:bg-muted transition-colors shrink-0"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="flex flex-wrap gap-3 mb-6 pb-4 border-b border-border/50">
              <StatusBadge status={selectedDoc.status} />
              <span className="text-sm text-muted-foreground">
                {formatFileSize(selectedDoc.fileSize)}
              </span>
              <span className="text-sm text-muted-foreground">
                {selectedDoc.chunkCount} chunks
              </span>
              <span className="text-sm text-muted-foreground">
                {new Date(selectedDoc._creationTime).toLocaleDateString()}
              </span>
            </div>

            {selectedDoc.metadata ? (
              <MetadataPanel
                metadata={selectedDoc.metadata as Record<string, unknown>}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No metadata extracted
              </p>
            )}

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border/50">
              <Button variant="outline" onClick={() => setSelectedDoc(null)}>
                Close
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  handleDelete(selectedDoc);
                  setSelectedDoc(null);
                }}
                disabled={deletingId === selectedDoc._id}
              >
                {deletingId === selectedDoc._id ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
