import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FolderNode } from "./FolderNode";
import { InlineEdit } from "./InlineEdit";
import { useOrg } from "@/hooks/useOrg";
import type { Id, ConvexFolder } from "@/types";

interface FolderTreeProps {
  selectedFolderId: Id<"folders"> | null;
  onSelectFolder: (folderId: string | null, folderName: string | null) => void;
}

export function FolderTree({
  selectedFolderId,
  onSelectFolder,
}: FolderTreeProps) {
  const { activeOrgId } = useOrg();
  const folders = useQuery(
    api.folders.queries.list,
    activeOrgId ? { orgId: activeOrgId } : "skip"
  ) as ConvexFolder[] | undefined;
  const createFolder = useMutation(api.folders.mutations.create);
  const reorderFolder = useMutation(api.folders.mutations.reorder);
  const moveFolder = useMutation(api.folders.mutations.move);
  const [isCreatingRoot, setIsCreatingRoot] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rootDropOver, setRootDropOver] = useState(false);

  const handleReorder = (folderId: string, newIndex: number) => {
    if (!activeOrgId) return;
    reorderFolder({ orgId: activeOrgId, folderId: folderId as Id<"folders">, newIndex });
  };

  const handleMove = (folderId: string, newParentId: string | undefined) => {
    if (!activeOrgId) return;
    moveFolder({
      orgId: activeOrgId,
      folderId: folderId as Id<"folders">,
      newParentId: newParentId ? (newParentId as Id<"folders">) : undefined,
    });
  };

  const loading = folders === undefined;

  const handleCreateRootFolder = async (name: string) => {
    if (!activeOrgId) return;
    try {
      setCreateError(null);
      await createFolder({ orgId: activeOrgId, name });
      setIsCreatingRoot(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create folder";
      setCreateError(message);
    }
  };

  const handleStartCreate = () => {
    setIsCreatingRoot(true);
    setCreateError(null);
  };

  const handleCancelCreate = () => {
    setIsCreatingRoot(false);
    setCreateError(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Folders
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-lg hover:bg-accent/50 transition-colors"
          onClick={handleStartCreate}
          title="New folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-2 px-3">
          Loading folders...
        </div>
      ) : (
        <>
          {folders.map((folder, i) => (
            <FolderNode
              key={folder._id}
              folder={folder}
              level={0}
              selectedId={selectedFolderId}
              onSelect={onSelectFolder}
              onReorder={handleReorder}
              onMove={handleMove}
              index={i}
              siblings={folders}
            />
          ))}

          {/* Drop zone for moving folders to root */}
          <div
            className={cn(
              "h-6 mx-2 rounded transition-colors",
              rootDropOver && "bg-primary/10 ring-2 ring-primary/50"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setRootDropOver(true);
            }}
            onDragLeave={() => setRootDropOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setRootDropOver(false);
              const draggedId = e.dataTransfer.getData("text/plain");
              if (draggedId) {
                handleMove(draggedId, undefined);
              }
            }}
          >
            {rootDropOver && (
              <div className="text-xs text-muted-foreground text-center py-1">
                Move to root
              </div>
            )}
          </div>

          {isCreatingRoot && (
            <div
              className="flex items-center gap-1 py-1 px-2 animate-fade-in"
              style={{ paddingLeft: "24px" }}
            >
              <InlineEdit
                value=""
                onSave={handleCreateRootFolder}
                onCancel={handleCancelCreate}
                error={createError}
              />
            </div>
          )}

          {folders.length === 0 && !isCreatingRoot && (
            <div className="text-xs text-muted-foreground py-3 px-3 text-center">
              No folders yet. Click + to create one.
            </div>
          )}
        </>
      )}
    </div>
  );
}
