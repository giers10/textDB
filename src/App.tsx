import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appDataDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import historyIcon from "./assets/history.png";
import {
  createText,
  deleteText,
  deleteTextVersion,
  discardDraft,
  getDraft,
  getLatestManualVersion,
  getText,
  listTexts,
  listVersions,
  searchTexts,
  saveManualVersion,
  updateTextTitle,
  upsertDraft,
  type Text,
} from "./lib/db";

const formatDate = (timestamp: number) => {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString();
};

type HistorySnapshot = {
  body: string;
  lastPersistedBody: string;
  lastPersistedTitle: string;
  hasDraft: boolean;
  restoredDraft: boolean;
  draftBaseVersionId: string | null;
  latestManualVersionId: string | null;
};

type ConfirmState = {
  title: string;
  message: string;
  actionLabel?: string;
  onConfirm: () => Promise<void> | void;
};

type HistoryEntry = {
  id: string;
  created_at: number;
  kind: "manual" | "draft";
  body: string;
  baseVersionId?: string | null;
};

const DEFAULT_TITLE = "Untitled Text";

export default function App() {
  const [texts, setTexts] = useState<Text[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadingTexts, setLoadingTexts] = useState(true);

  const [title, setTitle] = useState("");
  const [lastPersistedTitle, setLastPersistedTitle] = useState("");
  const [body, setBody] = useState("");
  const [lastPersistedBody, setLastPersistedBody] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [latestManualVersionId, setLatestManualVersionId] = useState<string | null>(null);
  const [draftBaseVersionId, setDraftBaseVersionId] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([]);
  const [viewingVersion, setViewingVersion] = useState<HistoryEntry | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const bodyRef = useRef(body);
  const historySnapshotRef = useRef<HistorySnapshot | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const [path] = event.payload.paths ?? [];
        if (!path || !path.toLowerCase().endsWith(".txt")) return;
        await createTextFromFile(path);
      })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error) => {
        console.error("Failed to register drag/drop handler", error);
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [createTextFromFile]);

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  const isViewingHistory = viewingVersion !== null;
  const isDirty = !isViewingHistory && body !== lastPersistedBody;
  const hasText = body.trim().length > 0;

  const statusKey = useMemo(() => {
    if (isViewingHistory) return "history";
    if (isDirty) return "unsaved";
    if (hasDraft) return "draft";
    return "saved";
  }, [hasDraft, isDirty, isViewingHistory]);

  const canSave = !isViewingHistory && (isDirty || hasDraft);

  const statusLabel = useMemo(() => {
    switch (statusKey) {
      case "history":
        return "Viewing history";
      case "unsaved":
        return "Unsaved";
      case "draft":
        return "Draft autosaved";
      default:
        return "Saved";
    }
  }, [statusKey]);

  const refreshTexts = useCallback(async () => {
    setLoadingTexts(true);
    try {
      const trimmed = search.trim();
      const rows = trimmed ? await searchTexts(trimmed) : await listTexts();
      setTexts(rows);
    } finally {
      setLoadingTexts(false);
    }
  }, [search]);

  const refreshVersions = useCallback(async () => {
    if (!selectedTextId || !historyOpen) return;
    const [manualRows, draft] = await Promise.all([
      listVersions(selectedTextId),
      getDraft(selectedTextId)
    ]);
    const manualItems: HistoryEntry[] = manualRows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      kind: "manual",
      body: row.body
    }));
    const draftItem: HistoryEntry[] = draft
      ? [
          {
            id: `draft:${selectedTextId}`,
            created_at: draft.updated_at,
            kind: "draft",
            body: draft.body,
            baseVersionId: draft.base_version_id ?? null
          }
        ]
      : [];
    const combined = [...draftItem, ...manualItems].sort(
      (a, b) => b.created_at - a.created_at
    );
    setHistoryItems(combined);
  }, [historyOpen, selectedTextId]);

  useEffect(() => {
    refreshTexts().catch((error) => {
      console.error("Failed to load texts", error);
    });
  }, [refreshTexts]);

  useEffect(() => {
    if (!selectedTextId && texts.length > 0) {
      setSelectedTextId(texts[0].id);
    }
  }, [selectedTextId, texts]);

  useEffect(() => {
    if (!historyOpen) {
      setHistoryItems([]);
      return;
    }
    refreshVersions().catch((error) => {
      console.error("Failed to load versions", error);
    });
  }, [historyOpen, refreshVersions]);

  useEffect(() => {
    if (!selectedTextId) {
      setTitle("");
      setLastPersistedTitle("");
      setBody("");
      setLastPersistedBody("");
      setHasDraft(false);
      setRestoredDraft(false);
      setLatestManualVersionId(null);
      setDraftBaseVersionId(null);
      setViewingVersion(null);
      setSelectedHistoryId(null);
      historySnapshotRef.current = null;
      return;
    }

    let cancelled = false;
    const loadText = async () => {
      const [text, manualVersion, draft] = await Promise.all([
        getText(selectedTextId),
        getLatestManualVersion(selectedTextId),
        getDraft(selectedTextId)
      ]);

      if (cancelled) return;

      if (!text) {
        setSelectedTextId(null);
        return;
      }

      const resolvedTitle = text.title || DEFAULT_TITLE;
      const resolvedBody = draft?.body ?? manualVersion?.body ?? "";
      const baseVersionId = draft?.base_version_id ?? manualVersion?.id ?? null;

      setTitle(resolvedTitle);
      setLastPersistedTitle(resolvedTitle);
      setBody(resolvedBody);
      setLastPersistedBody(resolvedBody);
      setHasDraft(Boolean(draft));
      setRestoredDraft(Boolean(draft));
      setLatestManualVersionId(manualVersion?.id ?? null);
      setDraftBaseVersionId(baseVersionId);
      setViewingVersion(null);
      setSelectedHistoryId(
        draft ? `draft:${selectedTextId}` : manualVersion?.id ?? null
      );
      historySnapshotRef.current = null;
    };

    loadText().catch((error) => {
      console.error("Failed to load text", error);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedTextId]);

  useEffect(() => {
    if (!selectedTextId || !isDirty || isViewingHistory) return;

    const currentBody = body;
    const handle = window.setTimeout(() => {
      upsertDraft(selectedTextId, currentBody, draftBaseVersionId)
        .then(() => {
          if (bodyRef.current !== currentBody) return;
          setHasDraft(true);
          setLastPersistedBody(currentBody);
          setSelectedHistoryId(`draft:${selectedTextId}`);
          if (historyOpen) {
            refreshVersions().catch((error) => {
              console.error("Failed to refresh history", error);
            });
          }
        })
        .catch((error) => {
          console.error("Failed to autosave draft", error);
        });
    }, 600);

    return () => window.clearTimeout(handle);
  }, [
    body,
    draftBaseVersionId,
    historyOpen,
    isDirty,
    isViewingHistory,
    refreshVersions,
    selectedTextId
  ]);

  const handleNewText = useCallback(async () => {
    const { textId } = await createText(DEFAULT_TITLE, "");
    await refreshTexts();
    setSelectedTextId(textId);
  }, [refreshTexts]);

  const createTextFromFile = useCallback(
    async (filePath: string) => {
      try {
        const filename = filePath.split(/[\/]/).pop() || DEFAULT_TITLE;
        const title = filename.replace(/\.txt$/i, "") || DEFAULT_TITLE;
        const contents = await readTextFile(filePath);
        const { textId } = await createText(title, contents);
        await refreshTexts();
        setSelectedTextId(textId);
      } catch (error) {
        console.error("Failed to open text file", error);
      }
    },
    [refreshTexts]
  );

  const handleFilePaths = useCallback(
    async (paths: string[]) => {
      const txtPaths = paths.filter((path) => path.toLowerCase().endsWith(".txt"));
      for (const path of txtPaths) {
        await createTextFromFile(path);
      }
    },
    [createTextFromFile]
  );

  const handleOpenText = useCallback(async () => {
    const baseDir = await appDataDir();
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: baseDir
    });
    if (!path || Array.isArray(path)) return;
    await createTextFromFile(path);
  }, [createTextFromFile]);

  const handleDeleteText = useCallback(
    async (promptId: string) => {
      await deleteText(promptId);
      await refreshTexts();
      if (selectedTextId === promptId) {
        setSelectedTextId(null);
      }
    },
    [refreshTexts, selectedTextId]
  );

  const handleSaveVersion = useCallback(async () => {
    if (!selectedTextId || !canSave) return;
    const normalizedTitle = title.trim() || DEFAULT_TITLE;
    if (normalizedTitle !== title) {
      setTitle(normalizedTitle);
    }
    const result = await saveManualVersion(selectedTextId, normalizedTitle, body);
    setLastPersistedBody(body);
    setLastPersistedTitle(normalizedTitle);
    setHasDraft(false);
    setRestoredDraft(false);
    setLatestManualVersionId(result.versionId);
    setDraftBaseVersionId(result.versionId);
    setSelectedHistoryId(result.versionId);
    await refreshTexts();
    await refreshVersions();
  }, [body, canSave, refreshTexts, refreshVersions, selectedTextId, title]);

  const applyTitleUpdate = useCallback((promptId: string, nextTitle: string) => {
    const now = Date.now();
    setTexts((prev) => {
      let updated: Text | null = null;
      const remaining: Text[] = [];
      for (const text of prev) {
        if (text.id === promptId) {
          updated = { ...text, title: nextTitle, updated_at: now };
        } else {
          remaining.push(text);
        }
      }
      if (!updated) return prev;
      return [updated, ...remaining];
    });
  }, []);

  const handleTitleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextTitle = event.target.value;
      setTitle(nextTitle);
      if (!selectedTextId || isViewingHistory) return;
      applyTitleUpdate(selectedTextId, nextTitle);
      setLastPersistedTitle(nextTitle);
      updateTextTitle(selectedTextId, nextTitle).catch((error) => {
        console.error("Failed to update title", error);
      });
    },
    [applyTitleUpdate, isViewingHistory, selectedTextId]
  );

  const handleDiscardDraft = useCallback(async () => {
    if (!selectedTextId || isViewingHistory) return;
    await discardDraft(selectedTextId);
    const manualVersion = await getLatestManualVersion(selectedTextId);
    const resolvedBody = manualVersion?.body ?? "";
    setBody(resolvedBody);
    setLastPersistedBody(resolvedBody);
    setHasDraft(false);
    setRestoredDraft(false);
    setLatestManualVersionId(manualVersion?.id ?? null);
    setDraftBaseVersionId(manualVersion?.id ?? null);
    setSelectedHistoryId(manualVersion?.id ?? null);
    await refreshVersions();
  }, [isViewingHistory, refreshVersions, selectedTextId]);

  const handleExportText = useCallback(async () => {
    if (!hasText) return;
    const filename = `${title.trim() || DEFAULT_TITLE}.txt`;
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    if (!path) return;
    const finalPath = path.endsWith(".txt") ? path : `${path}.txt`;
    await writeTextFile(finalPath, body);
  }, [body, hasText, title]);

  const handleExitHistory = useCallback(() => {
    const snapshot = historySnapshotRef.current;
    if (snapshot) {
      setBody(snapshot.body);
      setLastPersistedBody(snapshot.lastPersistedBody);
      setLastPersistedTitle(snapshot.lastPersistedTitle);
      setHasDraft(snapshot.hasDraft);
      setRestoredDraft(snapshot.restoredDraft);
      setDraftBaseVersionId(snapshot.draftBaseVersionId);
      setLatestManualVersionId(snapshot.latestManualVersionId);
    }
    setViewingVersion(null);
    setSelectedHistoryId(null);
    historySnapshotRef.current = null;
  }, []);

  const applyVersionAsCurrent = useCallback(
    (version: HistoryEntry) => {
      const snapshot = historySnapshotRef.current;
      if (snapshot) {
        setLastPersistedBody(snapshot.lastPersistedBody);
        setLastPersistedTitle(snapshot.lastPersistedTitle);
        setHasDraft(snapshot.hasDraft);
        setRestoredDraft(snapshot.restoredDraft);
        setLatestManualVersionId(snapshot.latestManualVersionId);
      }
      setDraftBaseVersionId(
        version.kind === "manual" ? version.id : version.baseVersionId ?? null
      );
      setBody(version.body);
      setLastPersistedBody(version.body);
      setViewingVersion(null);
      setSelectedHistoryId(version.id);
      historySnapshotRef.current = null;
    },
    []
  );

  const handleDeleteVersion = useCallback(
    async (version: HistoryEntry) => {
      if (!selectedTextId) return;

      const currentItems = historyItems;
      const index = currentItems.findIndex((item) => item.id === version.id);
      const olderCandidate =
        index >= 0 ? currentItems[index + 1] ?? null : null;
      const fallbackCandidate =
        index > 0 ? currentItems[index - 1] ?? null : null;
      const shouldAutoSelect =
        historyOpen && (!viewingVersion || viewingVersion.id === version.id);

      if (version.kind === "draft") {
        await discardDraft(selectedTextId);
        setHasDraft(false);
        setRestoredDraft(false);
        setDraftBaseVersionId(latestManualVersionId ?? null);
        if (historySnapshotRef.current) {
          historySnapshotRef.current.hasDraft = false;
          historySnapshotRef.current.restoredDraft = false;
          historySnapshotRef.current.draftBaseVersionId =
            latestManualVersionId ?? null;
        }
      } else {
        await deleteTextVersion(selectedTextId, version.id);
      }
      await refreshVersions();

      if (version.kind === "manual" && latestManualVersionId === version.id) {
        const manualVersion = await getLatestManualVersion(selectedTextId);
        const resolvedBody = manualVersion?.body ?? "";
        const nextManualId = manualVersion?.id ?? null;
        setLatestManualVersionId(nextManualId);
        setDraftBaseVersionId(nextManualId);
        if (historySnapshotRef.current) {
          historySnapshotRef.current.latestManualVersionId = nextManualId;
          historySnapshotRef.current.draftBaseVersionId = nextManualId;
        }
        if (!hasDraft && !isViewingHistory) {
          setBody(resolvedBody);
          setLastPersistedBody(resolvedBody);
        }
      }

      if (shouldAutoSelect) {
        if (olderCandidate) {
          applyVersionAsCurrent(olderCandidate);
        } else if (fallbackCandidate) {
          applyVersionAsCurrent(fallbackCandidate);
        } else {
          handleExitHistory();
        }
      }
    },
    [
      applyVersionAsCurrent,
      handleExitHistory,
      hasDraft,
      isViewingHistory,
      historyOpen,
      latestManualVersionId,
      refreshVersions,
      selectedTextId,
      historyItems,
      viewingVersion
    ]
  );

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    const action = confirmState.onConfirm;
    setConfirmState(null);
    try {
      await action();
    } catch (error) {
      console.error("Delete failed", error);
    }
  }, [confirmState]);

  const handleTitleBlur = useCallback(async () => {
    if (!selectedTextId || isViewingHistory) return;
    const normalizedTitle = title.trim() || DEFAULT_TITLE;
    if (normalizedTitle !== title) {
      setTitle(normalizedTitle);
      applyTitleUpdate(selectedTextId, normalizedTitle);
    }
    if (normalizedTitle === lastPersistedTitle) return;
    await updateTextTitle(selectedTextId, normalizedTitle);
    setLastPersistedTitle(normalizedTitle);
    await refreshTexts();
  }, [
    applyTitleUpdate,
    isViewingHistory,
    lastPersistedTitle,
    refreshTexts,
    selectedTextId,
    title
  ]);

  const handleToggleHistory = useCallback(() => {
    if (historyOpen && viewingVersion) {
      const snapshot = historySnapshotRef.current;
      if (snapshot) {
        setBody(snapshot.body);
        setLastPersistedBody(snapshot.lastPersistedBody);
        setLastPersistedTitle(snapshot.lastPersistedTitle);
        setHasDraft(snapshot.hasDraft);
        setRestoredDraft(snapshot.restoredDraft);
        setDraftBaseVersionId(snapshot.draftBaseVersionId);
        setLatestManualVersionId(snapshot.latestManualVersionId);
      }
      setViewingVersion(null);
      historySnapshotRef.current = null;
    }
    setHistoryOpen((prev) => !prev);
  }, [historyOpen, viewingVersion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSave =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSave) return;
      event.preventDefault();
      handleSaveVersion().catch((error) => {
        console.error("Failed to save version", error);
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveVersion]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="app-title">TextDB</div>
          <input
            className="search"
            placeholder="Search texts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="prompt-list">
          <div className="prompt-list__inner">
            {loadingTexts ? (
              <div className="empty">Loading texts…</div>
            ) : texts.length === 0 ? (
              <div className="empty">No texts yet.</div>
            ) : (
              texts.map((text) => (
                <div
                  key={text.id}
                  className={`prompt-item${
                    text.id === selectedTextId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedTextId(text.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedTextId(text.id);
                    }
                  }}
                >
                  <div className="prompt-item__content">
                    <div className="prompt-item__title">{text.title}</div>
                    <div className="prompt-item__meta">
                      Updated {formatDate(text.updated_at)}
                    </div>
                  </div>
                  <button
                    className="prompt-item__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmState({
                        title: "Delete text",
                        message: `Delete \"${text.title}\"? This removes all versions and drafts.`,
                        actionLabel: "Delete text",
                        onConfirm: () => handleDeleteText(text.id)
                      });
                    }}
                    aria-label="Delete text"
                    title="Delete text"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="sidebar__footer">
          <button className="button button--primary" onClick={handleNewText}>
            New Text
          </button>
          <button className="button" onClick={handleOpenText}>
            Open Text
          </button>
        </div>
      </aside>

      <main className="workspace">
        {!selectedTextId ? (
          <div className="empty-state">
            <div className="empty-state__title">Create your first text</div>
            <div className="empty-state__subtitle">
              Everything stays offline in a single SQLite database.
            </div>
            <button className="button button--primary" onClick={handleNewText}>
              New Text
            </button>
          </div>
        ) : (
          <div
            className={`workspace__content${
              historyOpen ? " workspace__content--history" : ""
            }`}
          >
            <section className="editor">
              <div className="editor__header">
                <input
                  className="title-input"
                  value={title}
                  onChange={handleTitleChange}
                  onBlur={handleTitleBlur}
                  placeholder="Text title"
                  disabled={isViewingHistory}
                />
                <div className="editor__status-row">
                  <div className="status-line">
                    <span className={`status status--${statusKey}`}></span>
                    {statusLabel}
                  </div>
                  <button
                    className={`icon-button${historyOpen ? " is-active" : ""}`}
                    onClick={handleToggleHistory}
                    aria-label={historyOpen ? "Close history" : "Open history"}
                    title={historyOpen ? "Close history" : "Open history"}
                    type="button"
                  >
                    <img src={historyIcon} alt="" className="icon-button__img" />
                  </button>
                </div>
              </div>

              <textarea
                className="editor__textarea"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write your text here…"
                readOnly={isViewingHistory}
              />

              <div className="editor__footer">
                {hasText ? (
                  <button className="button" onClick={handleExportText}>
                    Export Text
                  </button>
                ) : null}
                {hasDraft && !isViewingHistory ? (
                  <button
                    className="button"
                    onClick={() =>
                      setConfirmState({
                        title: "Discard draft",
                        message: "Discard this draft? This cannot be undone.",
                        actionLabel: "Discard draft",
                        onConfirm: handleDiscardDraft
                      })
                    }
                  >
                    Discard Draft
                  </button>
                ) : null}
                <button
                  className="button button--primary button--save"
                  onClick={handleSaveVersion}
                  disabled={!canSave}
                >
                  Save Version (⌘S)
                </button>
              </div>
            </section>

            {historyOpen ? (
              <aside className="history">
                <div className="history__header">
                  <span>History</span>
                  <button
                    className="history__close"
                    onClick={handleToggleHistory}
                    aria-label="Close history"
                    title="Close history"
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="history__list">
                  {historyItems.length === 0 ? (
                    <div className="empty">No versions yet.</div>
                  ) : (
                    historyItems.map((version) => (
                      <div
                        key={version.id}
                        className={`history__item${
                          selectedHistoryId === version.id ? " is-active" : ""
                        }`}
                        onClick={() => applyVersionAsCurrent(version)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            applyVersionAsCurrent(version);
                          }
                        }}
                      >
                        <div className="history__item-content">
                          <div className="history__item-title">
                            {formatDate(version.created_at)}
                          </div>
                          <div className="history__item-meta">
                            {version.kind === "draft" ? "Draft" : "Manual save"}
                          </div>
                        </div>
                        <button
                          className="history__item-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmState({
                              title:
                                version.kind === "draft"
                                  ? "Discard draft"
                                  : "Delete version",
                              message:
                                version.kind === "draft"
                                  ? "Discard this draft? This cannot be undone."
                                  : "Delete this version? This cannot be undone.",
                              actionLabel:
                                version.kind === "draft"
                                  ? "Discard draft"
                                  : "Delete version",
                              onConfirm: () => handleDeleteVersion(version)
                            });
                          }}
                          aria-label={
                            version.kind === "draft"
                              ? "Discard draft"
                              : "Delete version"
                          }
                          title={
                            version.kind === "draft"
                              ? "Discard draft"
                              : "Delete version"
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </main>

      {confirmState ? (
        <div className="modal">
          <div className="modal__overlay" onClick={() => setConfirmState(null)} />
          <div className="modal__card" role="dialog" aria-modal="true">
            <div className="modal__title">{confirmState.title}</div>
            <div className="modal__message">{confirmState.message}</div>
            <div className="modal__actions">
              <button className="button" onClick={() => setConfirmState(null)}>
                Cancel
              </button>
              <button className="button button--danger" onClick={handleConfirm}>
                {confirmState.actionLabel ?? "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
