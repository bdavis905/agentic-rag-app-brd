import { ReactNode, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { FolderPlus, Edit, MoveUp, Trash } from "lucide-react";
import type { ConvexFolder } from "@/types";

interface FolderContextMenuProps {
  folder: ConvexFolder;
  children: ReactNode;
  onCreateSubfolder: () => void;
  onRename: () => void;
  onDelete: () => Promise<void>;
  onMoveToRoot?: () => void;
  disabled?: boolean;
}

export function FolderContextMenu({
  folder,
  children,
  onCreateSubfolder,
  onRename,
  onDelete,
  onMoveToRoot,
  disabled = false,
}: FolderContextMenuProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Failed to delete folder:", error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={disabled}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onCreateSubfolder}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New Subfolder
          </ContextMenuItem>
          <ContextMenuItem onClick={onRename}>
            <Edit className="mr-2 h-4 w-4" />
            Rename
          </ContextMenuItem>
          {onMoveToRoot && (
            <ContextMenuItem onClick={onMoveToRoot}>
              <MoveUp className="mr-2 h-4 w-4" />
              Move to Root
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setShowDeleteDialog(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash className="mr-2 h-4 w-4" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete &quot;{folder.name}&quot; and all its subfolders.
              Documents in this folder will become unfiled. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
