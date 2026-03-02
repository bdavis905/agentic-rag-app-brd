import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ChevronRight, Folder as FolderIcon, FolderPlus, GripVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { FolderContextMenu } from "./FolderContextMenu";
import { InlineEdit } from "./InlineEdit";
import { useOrg } from "@/hooks/useOrg";
import type { ConvexFolder, Id } from "@/types";

interface FolderNodeProps {
  folder: ConvexFolder;
  level: number;
  selectedId: Id<"folders"> | null;
  onSelect: (id: string | null, name: string | null) => void;
  onReorder?: (folderId: string, newIndex: number) => void;
  onMove?: (folderId: string, newParentId: string | undefined) => void;
  index?: number;
  siblings?: ConvexFolder[];
}

export function FolderNode({
  folder,
  level,
  selectedId,
  onSelect,
  onReorder,
  onMove,
  index,
}: FolderNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isCreatingChild, setIsCreatingChild] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState<"above" | "below" | "inside" | null>(null);

  const isSelected = selectedId === folder._id;
  const { activeOrgId } = useOrg();

  // Convex reactive query for child folders — only fetched when expanded
  const children = useQuery(
    api.folders.queries.list,
    isOpen && activeOrgId ? { orgId: activeOrgId, parentId: folder._id } : "skip"
  ) as ConvexFolder[] | undefined;

  const createFolder = useMutation(api.folders.mutations.create);
  const renameFolderMut = useMutation(api.folders.mutations.rename);
  const deleteFolderMut = useMutation(api.folders.mutations.remove);
  const reorderMut = useMutation(api.folders.mutations.reorder);

  const moveFolderMut = useMutation(api.folders.mutations.move);

  const handleChildReorder = (folderId: string, newIndex: number) => {
    if (!activeOrgId) return;
    reorderMut({ orgId: activeOrgId, folderId: folderId as Id<"folders">, newIndex });
  };

  const handleChildMove = (folderId: string, newParentId: string | undefined) => {
    if (!activeOrgId) return;
    moveFolderMut({
      orgId: activeOrgId,
      folderId: folderId as Id<"folders">,
      newParentId: newParentId ? (newParentId as Id<"folders">) : undefined,
    });
  };

  const handleMoveToRoot = () => {
    if (onMove) {
      onMove(folder._id, undefined);
    }
  };

  const handleCreateSubfolder = () => {
    setIsOpen(true);
    setIsCreatingChild(true);
    setCreateError(null);
  };

  const handleSaveNewFolder = async (name: string) => {
    if (!activeOrgId) return;
    try {
      setCreateError(null);
      await createFolder({ orgId: activeOrgId, name, parentId: folder._id });
      setIsCreatingChild(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create folder";
      setCreateError(message);
    }
  };

  const handleCancelCreate = () => {
    setIsCreatingChild(false);
    setCreateError(null);
  };

  const handleStartRename = () => {
    setIsRenaming(true);
    setRenameError(null);
  };

  const handleRename = async (newName: string) => {
    if (!activeOrgId) return;
    try {
      setRenameError(null);
      await renameFolderMut({ orgId: activeOrgId, folderId: folder._id, name: newName });
      setIsRenaming(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rename folder";
      setRenameError(message);
    }
  };

  const handleCancelRename = () => {
    setIsRenaming(false);
    setRenameError(null);
  };

  const handleDelete = async () => {
    if (!activeOrgId) return;
    await deleteFolderMut({ orgId: activeOrgId, folderId: folder._id });
    if (selectedId === folder._id) {
      onSelect(null, null);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await handleDelete();
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Failed to delete folder:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(folder._id, folder.name);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", folder._id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.types.includes("text/plain") ? true : false;
    if (!draggedId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const zone = y / height;
    if (zone < 0.25) {
      setDragOver("above");
    } else if (zone > 0.75) {
      setDragOver("below");
    } else {
      setDragOver("inside");
    }
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentDragOver = dragOver;
    setDragOver(null);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === folder._id) return;

    if (currentDragOver === "inside") {
      // Move into this folder
      if (onMove) {
        onMove(draggedId, folder._id);
        setIsOpen(true);
      }
    } else if (index !== undefined && onReorder) {
      // Reorder among siblings
      const dropIndex = currentDragOver === "above" ? index : index + 1;
      onReorder(draggedId, dropIndex);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <FolderContextMenu
        folder={folder}
        onCreateSubfolder={handleCreateSubfolder}
        onRename={handleStartRename}
        onDelete={handleDelete}
        onMoveToRoot={folder.parentId ? handleMoveToRoot : undefined}
      >
        <div
          className={cn(
            "group relative flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted/50",
            isSelected && "bg-accent",
            dragOver === "above" && "border-t-2 border-primary",
            dragOver === "below" && "border-b-2 border-primary",
            dragOver === "inside" && "ring-2 ring-primary/50 bg-primary/10"
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={handleClick}
          draggable={!!onReorder}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <CollapsibleTrigger asChild onClick={handleToggle}>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0 hover:bg-transparent"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-90"
                )}
              />
            </Button>
          </CollapsibleTrigger>

          <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />

          {isRenaming ? (
            <InlineEdit
              value={folder.name}
              onSave={handleRename}
              onCancel={handleCancelRename}
              error={renameError}
            />
          ) : (
            <>
              <span className="text-sm truncate flex-1">{folder.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {onReorder && (
                  <span
                    className="cursor-grab active:cursor-grabbing h-6 w-6 flex items-center justify-center"
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Drag to reorder"
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateSubfolder();
                  }}
                  title="New subfolder"
                >
                  <FolderPlus className="h-3 w-3 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartRename();
                  }}
                  title="Rename"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteDialog(true);
                  }}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </>
          )}
        </div>
      </FolderContextMenu>

      <CollapsibleContent>
        {children === undefined && isOpen && (
          <div
            className="text-xs text-muted-foreground py-1"
            style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
          >
            Loading...
          </div>
        )}
        {children?.map((child, i) => (
          <FolderNode
            key={child._id}
            folder={child}
            level={level + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            onReorder={handleChildReorder}
            onMove={handleChildMove}
            index={i}
            siblings={children}
          />
        ))}
        {isCreatingChild && (
          <div
            className="flex items-center gap-1 py-1 px-2"
            style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
          >
            <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <InlineEdit
              value=""
              onSave={handleSaveNewFolder}
              onCancel={handleCancelCreate}
              error={createError}
            />
          </div>
        )}
      </CollapsibleContent>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete &quot;{folder.name}&quot; and all its subfolders.
              Documents in this folder will become unfiled. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}
