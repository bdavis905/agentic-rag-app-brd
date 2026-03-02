import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ChevronRight } from "lucide-react";
import { useOrg } from "@/hooks/useOrg";
import type { Id } from "@/types";

interface FolderBreadcrumbsProps {
  folderId: Id<"folders"> | null;
  folderName: string | null;
  onNavigate: (folderId: string | null, folderName: string | null) => void;
  onFolderNameLoaded?: (name: string) => void;
}

export function FolderBreadcrumbs({
  folderId,
  folderName,
  onNavigate,
  onFolderNameLoaded,
}: FolderBreadcrumbsProps) {
  const { activeOrgId } = useOrg();
  const ancestors = useQuery(
    api.folders.queries.getAncestors,
    folderId && activeOrgId ? { orgId: activeOrgId, folderId } : "skip"
  );

  useEffect(() => {
    if (
      !folderName &&
      ancestors &&
      ancestors.length > 0 &&
      onFolderNameLoaded
    ) {
      onFolderNameLoaded(ancestors[ancestors.length - 1].name);
    }
  }, [ancestors, folderName, onFolderNameLoaded]);

  if (!folderId) {
    return (
      <h1 className="text-2xl font-semibold tracking-tight">All Documents</h1>
    );
  }

  if (ancestors === undefined) {
    return (
      <h1 className="text-2xl font-semibold tracking-tight text-muted-foreground">
        Loading...
      </h1>
    );
  }

  const parentAncestors = ancestors.slice(0, -1);
  const currentFolderName =
    folderName || ancestors[ancestors.length - 1]?.name || "";

  return (
    <nav className="flex items-center text-2xl font-semibold tracking-tight text-muted-foreground">
      <button
        onClick={() => onNavigate(null, null)}
        className="hover:text-foreground transition-colors"
      >
        All Documents
      </button>
      {parentAncestors.map((ancestor) => (
        <span key={ancestor.id} className="flex items-center">
          <ChevronRight className="h-5 w-5 mx-2 text-muted-foreground/50" />
          <button
            onClick={() => onNavigate(ancestor.id, ancestor.name)}
            className="hover:text-foreground transition-colors"
          >
            {ancestor.name}
          </button>
        </span>
      ))}
      <ChevronRight className="h-5 w-5 mx-2 text-muted-foreground/50" />
      <span className="text-foreground">{currentFolderName}</span>
    </nav>
  );
}
