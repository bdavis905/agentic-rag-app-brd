import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import { Plus, Pencil, Trash2, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useOrg } from "@/hooks/useOrg";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Id } from "@/types";
import logo from "/logo-brd.jpg";

type Skill = Doc<"skills">;

interface SkillFormState {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

const emptyForm: SkillFormState = {
  name: "",
  description: "",
  instructions: "",
  enabled: true,
};

export function SkillsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrg();

  const skills = useQuery(
    api.skills.queries.list,
    activeOrgId ? { orgId: activeOrgId } : "skip",
  );

  const createSkill = useMutation(api.skills.mutations.create);
  const updateSkill = useMutation(api.skills.mutations.update);
  const removeSkill = useMutation(api.skills.mutations.remove);
  const toggleEnabled = useMutation(api.skills.mutations.toggleEnabled);

  const [editingId, setEditingId] = useState<Id<"skills"> | "new" | null>(null);
  const [form, setForm] = useState<SkillFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setEditingId("new");
    setForm(emptyForm);
    setError(null);
  };

  const openEdit = (skill: Skill) => {
    setEditingId(skill._id);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      enabled: skill.enabled,
    });
    setError(null);
  };

  const closeEditor = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const handleSave = async () => {
    if (!activeOrgId) return;
    if (!form.name.trim() || !form.description.trim() || !form.instructions.trim()) {
      setError("All fields are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") {
        await createSkill({
          orgId: activeOrgId,
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          enabled: form.enabled,
        });
      } else if (editingId) {
        await updateSkill({
          orgId: activeOrgId,
          skillId: editingId,
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          enabled: form.enabled,
        });
      }
      closeEditor();
    } catch (e: any) {
      setError(e.message || "Failed to save skill.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skillId: Id<"skills">) => {
    if (!activeOrgId) return;
    try {
      await removeSkill({ orgId: activeOrgId, skillId });
      if (editingId === skillId) closeEditor();
    } catch (e: any) {
      setError(e.message || "Failed to delete skill.");
    }
  };

  const handleToggle = async (skillId: Id<"skills">) => {
    if (!activeOrgId) return;
    await toggleEnabled({ orgId: activeOrgId, skillId });
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border/50 bg-surface-1">
        <div className="border-b border-border/50 p-4">
          <img src={logo} alt="Genesis" className="h-24" />
        </div>

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
            <button
              onClick={() => navigate("/documents")}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Documents
            </button>
            <button className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm transition-all duration-200">
              Skills
            </button>
          </div>
        </nav>

        <div className="flex-1" />

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
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Skills</h1>
            <p className="text-sm text-muted-foreground">
              Reusable instruction sets the AI can load on-demand during chat
            </p>
          </div>
          <Button onClick={openNew} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Skill
          </Button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Skills List */}
          <div className="flex-1 overflow-auto p-6">
            {!activeOrgId ? (
              <div className="text-center text-muted-foreground py-12">
                Select an organization to manage skills.
              </div>
            ) : skills === undefined ? (
              <div className="text-center text-muted-foreground py-12">
                Loading...
              </div>
            ) : skills.length === 0 && editingId !== "new" ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">
                  No skills yet. Create one to extend your AI assistant.
                </p>
                <Button onClick={openNew} variant="outline">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Create your first skill
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 max-w-3xl">
                {skills?.map((skill: Skill) => (
                  <div
                    key={skill._id}
                    className={`rounded-lg border p-4 transition-colors ${
                      editingId === skill._id
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{skill.name}</h3>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full ${
                              skill.enabled
                                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {skill.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                          {skill.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleToggle(skill._id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            skill.enabled ? "bg-primary" : "bg-muted"
                          }`}
                          title={skill.enabled ? "Disable" : "Enable"}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                              skill.enabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => openEdit(skill)}
                          className="p-1.5 rounded-md hover:bg-accent/50 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleDelete(skill._id)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Editor Panel */}
          {editingId !== null && (
            <div className="w-[480px] border-l border-border/50 flex flex-col bg-surface-1">
              <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <h2 className="font-medium">
                  {editingId === "new" ? "New Skill" : "Edit Skill"}
                </h2>
                <button
                  onClick={closeEditor}
                  className="p-1 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 space-y-4">
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Name
                  </label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="e.g. code-reviewer"
                    className="font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Description
                  </label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="One-line description of what this skill does"
                  />
                </div>

                <div className="flex-1 flex flex-col">
                  <label className="text-sm font-medium mb-1.5 block">
                    Instructions
                  </label>
                  <textarea
                    value={form.instructions}
                    onChange={(e) =>
                      setForm({ ...form, instructions: e.target.value })
                    }
                    placeholder="Full instructions the AI should follow when this skill is activated..."
                    className="flex-1 min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setForm({ ...form, enabled: !form.enabled })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      form.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                        form.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {form.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>

              <div className="border-t border-border/50 p-4 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : editingId === "new" ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
