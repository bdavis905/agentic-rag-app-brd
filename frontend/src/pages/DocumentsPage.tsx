import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { UserButton } from "@clerk/clerk-react";
import { api } from "../../convex/_generated/api";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { DocumentList } from "@/components/documents/DocumentList";
import { FolderBreadcrumbs } from "@/components/documents/FolderBreadcrumbs";
import { FolderTree } from "@/components/folders/FolderTree";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Plus, X, Settings, FolderPlus, HardDrive } from "lucide-react";
import { GoogleDriveImport } from "@/components/documents/GoogleDriveImport";
import { useOrg } from "@/hooks/useOrg";
import type { Id } from "@/types";
import logo from "/logo.svg";

export function DocumentsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrg();
  const [selectedFolderId, setSelectedFolderId] = useState<
    Id<"folders"> | null
  >(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    null
  );
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDriveImport, setShowDriveImport] = useState(false);

  const createFolder = useMutation(api.folders.mutations.create);

  const handleCreateFolder = async () => {
    if (!activeOrgId) return;
    const name = selectedFolderId ? "New Subfolder" : "New Folder";
    await createFolder({
      orgId: activeOrgId,
      name,
      parentId: selectedFolderId ?? undefined,
    });
  };

  const documents = useQuery(
    api.documents.queries.list,
    activeOrgId
      ? { orgId: activeOrgId, folderId: selectedFolderId ?? undefined }
      : "skip"
  );

  const folders = useQuery(
    api.folders.queries.list,
    activeOrgId
      ? { orgId: activeOrgId, parentId: selectedFolderId ?? undefined }
      : "skip"
  );

  const handleSelectFolder = (
    folderId: string | null,
    folderName: string | null
  ) => {
    setSelectedFolderId(folderId as Id<"folders"> | null);
    setSelectedFolderName(folderName);
  };

  const handleBreadcrumbNavigate = (
    folderId: string | null,
    folderName: string | null
  ) => {
    setSelectedFolderId(folderId as Id<"folders"> | null);
    setSelectedFolderName(folderName);
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border/50 bg-surface-1">
        <div className="border-b border-border/50 p-4">
          <img src={logo} alt="Genesis" className="h-24" />
        </div>

        {/* Org Switcher */}
        <OrgSwitcher />

        {/* Navigation Tabs */}
        <nav className="border-b border-border/50 p-2">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            <button
              onClick={() => navigate("/")}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Chat
            </button>
            <button className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm transition-all duration-200">
              Documents
            </button>
          </div>
        </nav>

        {/* Folder Tree */}
        <div className="flex-1 overflow-auto py-2">
          <FolderTree
            selectedFolderId={selectedFolderId}
            onSelectFolder={handleSelectFolder}
          />
        </div>

        <div className="border-t border-border/50 p-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UserButton afterSignOutUrl="/" />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => navigate("/settings")}
                className="p-2 rounded-lg hover:bg-accent/50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-background">
        <div className="p-8 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <FolderBreadcrumbs
                folderId={selectedFolderId}
                folderName={selectedFolderName}
                onNavigate={handleBreadcrumbNavigate}
                onFolderNameLoaded={setSelectedFolderName}
              />
              <p className="text-muted-foreground mt-1">
                Upload documents to use as context in your chats.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleCreateFolder}
                className="flex items-center gap-2"
                disabled={!activeOrgId}
              >
                <FolderPlus className="w-4 h-4" />
                Folder
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDriveImport(true)}
                className="flex items-center gap-2"
              >
                <HardDrive className="w-4 h-4" />
                Google Drive
              </Button>
              <Button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2"
                disabled={!activeOrgId}
              >
                <Plus className="w-4 h-4" />
                Add Files
              </Button>
            </div>
          </div>

          <DocumentList
            folders={folders ?? []}
            documents={documents ?? []}
            loading={documents === undefined}
            onSelectFolder={handleSelectFolder}
          />
        </div>
      </div>

      {/* Google Drive Import Modal */}
      {showDriveImport && (
        <GoogleDriveImport
          onClose={(navigateToFolderId, folderName) => {
            setShowDriveImport(false);
            if (navigateToFolderId) {
              setSelectedFolderId(navigateToFolderId as Id<"folders">);
              setSelectedFolderName(folderName ?? null);
            }
          }}
          targetFolderId={selectedFolderId}
        />
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowUploadModal(false)}
          />
          <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Upload Files</h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <DocumentUpload
              onUploadComplete={() => setShowUploadModal(false)}
              onSkipped={() => {}}
              folderId={selectedFolderId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
