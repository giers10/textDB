import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appDataDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import historyIcon from "./assets/history.png";
import historyIconBright from "./assets/history_b.png";
import folderIcon from "../src-tauri/icons/folder.png";
import folderIconBright from "../src-tauri/icons/folder_b.png";
import { markdownToHTML } from "./markdown/markdown";
import "./markdown/markdown-render.css";
import {
  createFolder,
  createText,
  deleteFolder,
  deleteText,
  deleteTextVersion,
  discardDraft,
  getDraft,
  getLatestManualVersion,
  getText,
  listFolders,
  listTexts,
  listVersions,
  moveFolder,
  moveTextToFolder,
  saveManualVersion,
  searchTexts,
  updateFolderName,
  updateTextTitle,
  upsertDraft,
  type Folder,
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

type SidebarEntry =
  | { kind: "folder"; item: Folder }
  | { kind: "text"; item: Text };

const DEFAULT_TITLE = "Untitled Text";
const DEFAULT_FOLDER_NAME = "New Folder";

export default function App() {
  const [texts, setTexts] = useState<Text[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadingTexts, setLoadingTexts] = useState(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextTitle, setEditingTextTitle] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("textdb.expandedFolders");
    if (!stored) return new Set();
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((value) => typeof value === "string"));
      }
    } catch {
      return new Set();
    }
    return new Set();
  });
  const [theme, setTheme] = useState<"default" | "light">(() => {
    const storedTheme = localStorage.getItem("textdb.theme");
    return storedTheme === "light" ? "light" : "default";
  });
  const [textSize, setTextSize] = useState(() => {
    const storedSize = Number(localStorage.getItem("textdb.textSize"));
    if (!Number.isNaN(storedSize) && storedSize >= 12 && storedSize <= 18) {
      return storedSize;
    }
    return 16;
  });
  const [showLineNumbers, setShowLineNumbers] = useState(() => {
    return localStorage.getItem("textdb.lineNumbers") === "true";
  });
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  const [measureTick, setMeasureTick] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("textdb.sidebarCollapsed") === "true";
  });

  const bodyRef = useRef(body);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const historySnapshotRef = useRef<HistorySnapshot | null>(null);
  const recentOpenRef = useRef(new Map<string, number>());
  const ignoreTextBlurRef = useRef(false);
  const ignoreFolderBlurRef = useRef(false);


  useEffect(() => {
    bodyRef.current = body;
  }, [body]);


  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("textdb.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--base-font-size", `${textSize}px`);
    localStorage.setItem("textdb.textSize", String(textSize));
  }, [textSize]);

  useEffect(() => {
    localStorage.setItem("textdb.sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem("textdb.lineNumbers", String(showLineNumbers));
  }, [showLineNumbers]);

  useEffect(() => {
    localStorage.setItem(
      "textdb.expandedFolders",
      JSON.stringify(Array.from(expandedFolders))
    );
  }, [expandedFolders]);

  useEffect(() => {
    if (selectedTextId) {
      localStorage.setItem("textdb.selectedTextId", selectedTextId);
    }
  }, [selectedTextId]);

  const isViewingHistory = viewingVersion !== null;
  const isDirty = !isViewingHistory && body !== lastPersistedBody;
  const hasText = body.trim().length > 0;
  const showLineNumbersActive = showLineNumbers && !markdownPreview;
  const hasSearch = search.trim().length > 0;

  const folderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const folder of folders) {
      map.set(folder.id, folder);
    }
    return map;
  }, [folders]);

  const visibleFolderIds = useMemo(() => {
    if (!hasSearch) return null;
    const visible = new Set<string>();
    for (const text of texts) {
      let current = text.folder_id ?? null;
      while (current) {
        if (visible.has(current)) break;
        visible.add(current);
        current = folderById.get(current)?.parent_id ?? null;
      }
    }
    return visible;
  }, [folderById, hasSearch, texts]);

  const entriesByParent = useMemo(() => {
    const map = new Map<string | null, SidebarEntry[]>();
    const addEntry = (parentId: string | null, entry: SidebarEntry) => {
      const list = map.get(parentId);
      if (list) {
        list.push(entry);
      } else {
        map.set(parentId, [entry]);
      }
    };

    for (const folder of folders) {
      if (hasSearch && visibleFolderIds && !visibleFolderIds.has(folder.id)) {
        continue;
      }
      addEntry(folder.parent_id ?? null, { kind: "folder", item: folder });
    }

    for (const text of texts) {
      addEntry(text.folder_id ?? null, { kind: "text", item: text });
    }

    for (const [key, list] of map.entries()) {
      list.sort((a, b) => b.item.updated_at - a.item.updated_at);
      map.set(key, list);
    }
    return map;
  }, [folders, hasSearch, texts, visibleFolderIds]);

  const handleMarkdownPreviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const copyButton = target?.closest?.(".md-codeblock__copy") as HTMLElement | null;
      if (copyButton) {
        event.preventDefault();
        const encoded = copyButton.getAttribute("data-copy-code") ?? "";
        const text = decodeURIComponent(encoded);
        if (!text) return;
        writeClipboardText(text).catch(() => {
          if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text);
          }
        });
        return;
      }
      const link = target?.closest?.("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("/")) return;
      event.preventDefault();
      openExternal(href);
    },
    []
  );

  const handlePrintMarkdown = useCallback(() => {
    if (!markdownPreview) return;
    document.body.classList.add("print-markdown");
    const cleanup = () => {
      document.body.classList.remove("print-markdown");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => {
      window.print();
    });
  }, [markdownPreview]);

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

  const historyIconSrc = theme === "light" ? historyIconBright : historyIcon;
  const folderIconSrc = theme === "light" ? folderIconBright : folderIcon;

  const lines = useMemo(() => body.split("\n"), [body]);
  const lineNumbers = useMemo(() => lines.map((_, index) => index + 1), [lines]);

  const handleTextareaScroll = useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    if (!showLineNumbersActive) return;
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }, [showLineNumbersActive]);

  useEffect(() => {
    if (!showLineNumbersActive) return;
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setMeasureTick((tick) => tick + 1);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [showLineNumbersActive]);

  useEffect(() => {
    if (!showLineNumbersActive) return;
    let raf = 0;
    const handleResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setMeasureTick((tick) => tick + 1);
      });
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [showLineNumbersActive]);

  useLayoutEffect(() => {
    if (!showLineNumbersActive) return;
    const textarea = textareaRef.current;
    const measure = measureRef.current;
    if (!textarea || !measure) return;
    measure.style.width = `${textarea.clientWidth}px`;
    const heights = Array.from(measure.children).map((child) =>
      Math.ceil((child as HTMLElement).getBoundingClientRect().height)
    );
    setLineHeights(heights);
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textarea.scrollTop;
    }
  }, [lines, showLineNumbersActive, textSize, measureTick, sidebarCollapsed, historyOpen]);

  useEffect(() => {
    if (showLineNumbersActive && textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [showLineNumbersActive, body]);


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

  const refreshFolders = useCallback(async () => {
    setLoadingFolders(true);
    try {
      const rows = await listFolders();
      setFolders(rows);
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  const isFolderExpanded = useCallback(
    (folderId: string) => {
      if (hasSearch) {
        return visibleFolderIds?.has(folderId) ?? false;
      }
      return expandedFolders.has(folderId);
    },
    [expandedFolders, hasSearch, visibleFolderIds]
  );

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

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
    refreshFolders().catch((error) => {
      console.error("Failed to load folders", error);
    });
  }, [refreshFolders]);

  useEffect(() => {
    if (selectedTextId || texts.length === 0) return;
    const storedId = localStorage.getItem("textdb.selectedTextId");
    const fallback = texts[0].id;
    const resolved = storedId && texts.some((text) => text.id === storedId)
      ? storedId
      : fallback;
    setSelectedTextId(resolved);
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
      setMarkdownPreview(false);
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
        localStorage.removeItem("textdb.selectedTextId");
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
      setMarkdownPreview(false);
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
    const { textId } = await createText(DEFAULT_TITLE, "", null);
    await refreshTexts();
    setSelectedTextId(textId);
  }, [refreshTexts]);

  const handleNewFolder = useCallback(async () => {
    const { folderId } = await createFolder(DEFAULT_FOLDER_NAME, null);
    await refreshFolders();
    setEditingTextId(null);
    setEditingTextTitle("");
    setEditingFolderId(folderId);
    setEditingFolderName(DEFAULT_FOLDER_NAME);
  }, [refreshFolders]);

  const clearFolderEditing = useCallback(() => {
    setEditingFolderId(null);
    setEditingFolderName("");
  }, []);

  const clearTextEditing = useCallback(() => {
    setEditingTextId(null);
    setEditingTextTitle("");
  }, []);

  const startEditingFolder = useCallback((folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    setEditingTextId(null);
    setEditingTextTitle("");
  }, []);

  const startEditingText = useCallback((text: Text) => {
    setEditingTextId(text.id);
    setEditingTextTitle(text.title);
    setEditingFolderId(null);
    setEditingFolderName("");
  }, []);

  const commitFolderEdit = useCallback(async () => {
    if (!editingFolderId) return;
    const folderId = editingFolderId;
    const nextName = editingFolderName.trim() || DEFAULT_FOLDER_NAME;
    const currentName = folderById.get(folderId)?.name ?? "";
    clearFolderEditing();
    if (nextName === currentName) return;
    await updateFolderName(folderId, nextName);
    await refreshFolders();
  }, [
    clearFolderEditing,
    editingFolderId,
    editingFolderName,
    folderById,
    refreshFolders
  ]);

  const commitTextEdit = useCallback(async () => {
    if (!editingTextId) return;
    const textId = editingTextId;
    const nextTitle = editingTextTitle.trim() || DEFAULT_TITLE;
    const currentTitle = texts.find((text) => text.id === textId)?.title ?? "";
    clearTextEditing();
    if (nextTitle === currentTitle) return;
    if (selectedTextId === textId) {
      setTitle(nextTitle);
      setLastPersistedTitle(nextTitle);
    }
    await updateTextTitle(textId, nextTitle);
    await refreshTexts();
  }, [
    clearTextEditing,
    editingTextId,
    editingTextTitle,
    refreshTexts,
    selectedTextId,
    texts
  ]);

  const buildFolderPath = useCallback(
    (folderId: string) => {
      const names: string[] = [];
      let current: string | null = folderId;
      const seen = new Set<string>();
      while (current) {
        if (seen.has(current)) break;
        seen.add(current);
        const folder = folderById.get(current);
        if (!folder) break;
        names.unshift(folder.name);
        current = folder.parent_id ?? null;
      }
      return names.join(" / ");
    },
    [folderById]
  );

  const folderPathList = useMemo(() => {
    return folders
      .map((folder) => ({
        id: folder.id,
        label: buildFolderPath(folder.id)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [buildFolderPath, folders]);

  const isDescendantFolder = useCallback(
    (folderId: string, potentialAncestorId: string) => {
      let current: string | null = folderById.get(folderId)?.parent_id ?? null;
      while (current) {
        if (current === potentialAncestorId) return true;
        current = folderById.get(current)?.parent_id ?? null;
      }
      return false;
    },
    [folderById]
  );

  const handleMoveTextToFolder = useCallback(
    async (textId: string, folderId: string | null) => {
      await moveTextToFolder(textId, folderId);
      await refreshTexts();
      if (folderId) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(folderId);
          return next;
        });
      }
    },
    [refreshTexts]
  );

  const handleMoveFolderToFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      await moveFolder(folderId, parentId);
      await refreshFolders();
      if (parentId) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.add(parentId);
          return next;
        });
      }
    },
    [refreshFolders]
  );

  const handleDeleteText = useCallback(
    async (promptId: string) => {
      await deleteText(promptId);
      await refreshTexts();
      if (selectedTextId === promptId) {
        setSelectedTextId(null);
        localStorage.removeItem("textdb.selectedTextId");
      }
    },
    [refreshTexts, selectedTextId]
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      await deleteFolder(folderId);
      await Promise.all([refreshFolders(), refreshTexts()]);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      if (editingFolderId === folderId) {
        clearFolderEditing();
      }
    },
    [clearFolderEditing, editingFolderId, refreshFolders, refreshTexts]
  );

  const handleTextContextMenu = useCallback(
    async (event: React.MouseEvent, text: Text) => {
      event.preventDefault();
      const textId = text.id;
      const items = [
        {
          text: "Top level",
          action: () => {
            handleMoveTextToFolder(textId, null).catch((error) => {
              console.error("Failed to move text", error);
            });
          }
        },
        ...folderPathList.map((folder) => ({
          text: folder.label,
          action: () => {
            handleMoveTextToFolder(textId, folder.id).catch((error) => {
              console.error("Failed to move text", error);
            });
          }
        }))
      ];

      const menu = await Menu.new({
        items: [
          {
            text: "Rename",
            action: () => startEditingText(text)
          },
          {
            text: "Delete",
            action: () => {
              setConfirmState({
                title: "Delete text",
                message: `Delete \"${text.title}\"? This removes all versions and drafts.`,
                actionLabel: "Delete text",
                onConfirm: () => handleDeleteText(text.id)
              });
            }
          },
          {
            text: "Move to folder",
            items
          }
        ]
      });
      await menu.popup(undefined, getCurrentWindow());
    },
    [folderPathList, handleDeleteText, handleMoveTextToFolder, startEditingText]
  );

  const handleFolderContextMenu = useCallback(
    async (event: React.MouseEvent, folder: Folder) => {
      event.preventDefault();
      const moveTargets = [
        {
          text: "Top level",
          action: () => {
            handleMoveFolderToFolder(folder.id, null).catch((error) => {
              console.error("Failed to move folder", error);
            });
          }
        },
        ...folderPathList
          .filter(
            (candidate) =>
              candidate.id !== folder.id &&
              !isDescendantFolder(candidate.id, folder.id)
          )
          .map((candidate) => ({
            text: candidate.label,
            action: () => {
              handleMoveFolderToFolder(folder.id, candidate.id).catch((error) => {
                console.error("Failed to move folder", error);
              });
            }
          }))
      ];
      const menu = await Menu.new({
        items: [
          {
            text: "Rename",
            action: () => startEditingFolder(folder)
          },
          {
            text: "Delete",
            action: () => {
              setConfirmState({
                title: "Delete folder",
                message:
                  "Delete this folder? Its subfolders and texts will move one level up.",
                actionLabel: "Delete folder",
                onConfirm: () => handleDeleteFolder(folder.id)
              });
            }
          },
          {
            text: "Move to folder",
            items: moveTargets
          }
        ]
      });
      await menu.popup(undefined, getCurrentWindow());
    },
    [folderPathList, handleDeleteFolder, handleMoveFolderToFolder, isDescendantFolder, startEditingFolder]
  );

  const createTextFromFile = useCallback(
    async (filePath: string) => {
      try {
        const filename = filePath.split(/[\/]/).pop() || DEFAULT_TITLE;
        const title = filename.replace(/\.(txt|md)$/i, "") || DEFAULT_TITLE;
        const contents = await readTextFile(filePath);
        const { textId } = await createText(title, contents, null);
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
      const now = Date.now();
      const txtPaths = paths.filter((path) => {
        const lower = path.toLowerCase();
        return lower.endsWith(".txt") || lower.endsWith(".md");
      });
      const recent = recentOpenRef.current;
      for (const path of txtPaths) {
        const key = path.toLowerCase();
        const last = recent.get(key);
        if (last && now - last < 1000) continue;
        recent.set(key, now);
        await createTextFromFile(path);
      }
      for (const [key, timestamp] of recent.entries()) {
        if (now - timestamp > 2000) recent.delete(key);
      }
    },
    [createTextFromFile]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        await handleFilePaths(event.payload.paths ?? []);
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
  }, [handleFilePaths]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string[]>("file-opened", async (event) => {
      await handleFilePaths(event.payload ?? []);
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((error) => {
        console.error("Failed to register file-open listener", error);
      });

    invoke<string[]>("take_pending_opens")
      .then((paths) => handleFilePaths(paths ?? []))
      .catch((error) => {
        console.error("Failed to load pending file opens", error);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [handleFilePaths]);

  const handleOpenText = useCallback(async () => {
    const baseDir = await appDataDir();
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Text/Markdown", extensions: ["txt", "md"] }],
      defaultPath: baseDir
    });
    if (!path || Array.isArray(path)) return;
    await createTextFromFile(path);
  }, [createTextFromFile]);

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
    setTexts((prev) =>
      prev.map((text) =>
        text.id === promptId ? { ...text, title: nextTitle, updated_at: now } : text
      )
    );
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
      if (isSave) {
        event.preventDefault();
        handleSaveVersion().catch((error) => {
          console.error("Failed to save version", error);
        });
        return;
      }

      if (
        event.key === "Tab" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        selectedTextId &&
        !settingsOpen &&
        !confirmState &&
        !editingFolderId &&
        !editingTextId
      ) {
        event.preventDefault();
        setMarkdownPreview((value) => !value);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmState, editingFolderId, editingTextId, handleSaveVersion, selectedTextId, settingsOpen]);

  const renderTextItem = (text: Text) => (
    <div
      key={text.id}
      className={`prompt-item${text.id === selectedTextId ? " is-active" : ""}`}
      onClick={() => {
        if (editingTextId === text.id) return;
        setSelectedTextId(text.id);
      }}
      onContextMenu={(event) => handleTextContextMenu(event, text)}
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
        {editingTextId === text.id ? (
          <input
            className="prompt-item__input"
            value={editingTextTitle}
            onChange={(event) => setEditingTextTitle(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTextEdit().catch((error) => {
                  console.error("Failed to rename text", error);
                });
              } else if (event.key === "Escape") {
                event.preventDefault();
                ignoreTextBlurRef.current = true;
                clearTextEditing();
              }
            }}
            onBlur={() => {
              if (ignoreTextBlurRef.current) {
                ignoreTextBlurRef.current = false;
                return;
              }
              commitTextEdit().catch((error) => {
                console.error("Failed to rename text", error);
              });
            }}
            autoFocus
          />
        ) : (
          <div className="prompt-item__title">{text.title}</div>
        )}
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
  );

  const renderFolder = (folder: Folder) => {
    if (hasSearch && !visibleFolderIds?.has(folder.id)) return null;
    const expanded = isFolderExpanded(folder.id);
    const childEntries = entriesByParent.get(folder.id) ?? [];

    return (
      <div key={folder.id} className="folder-node">
        <div
          className={`folder-item${expanded ? " is-open" : ""}`}
          onClick={() => {
            if (editingFolderId === folder.id) return;
            toggleFolderExpanded(folder.id);
          }}
          onContextMenu={(event) => handleFolderContextMenu(event, folder)}
        >
          <div className="folder-item__lead">
            <button
              className="folder-item__toggle"
              type="button"
              aria-label={expanded ? "Collapse folder" : "Expand folder"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFolderExpanded(folder.id);
              }}
            >
              {expanded ? "▾" : "▸"}
            </button>
            <img src={folderIconSrc} alt="" className="folder-item__icon" />
          </div>
          {editingFolderId === folder.id ? (
            <input
              className="folder-item__input"
              value={editingFolderName}
              onChange={(event) => setEditingFolderName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitFolderEdit().catch((error) => {
                    console.error("Failed to rename folder", error);
                  });
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  ignoreFolderBlurRef.current = true;
                  clearFolderEditing();
                }
              }}
              onBlur={() => {
                if (ignoreFolderBlurRef.current) {
                  ignoreFolderBlurRef.current = false;
                  return;
                }
                commitFolderEdit().catch((error) => {
                  console.error("Failed to rename folder", error);
                });
              }}
              autoFocus
            />
          ) : (
            <div className="folder-item__title">{folder.name}</div>
          )}
          <button
            className="folder-item__delete"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmState({
                title: "Delete folder",
                message:
                  "Delete this folder? Its subfolders and texts will move one level up.",
                actionLabel: "Delete folder",
                onConfirm: () => handleDeleteFolder(folder.id)
              });
            }}
            aria-label="Delete folder"
            title="Delete folder"
          >
            ×
          </button>
        </div>
        {expanded && childEntries.length > 0 ? (
          <div className="folder-children">
            {childEntries.map((entry) =>
              entry.kind === "folder"
                ? renderFolder(entry.item)
                : renderTextItem(entry.item)
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`app app--theme-${theme}${sidebarCollapsed ? " app--sidebar-collapsed" : ""}`}>
      {!sidebarCollapsed ? (
        <aside className="sidebar">
          <div className="sidebar__header">
            <div className="sidebar__title-row">
              <div className="app-title">TextDB</div>
            </div>
            <input
              className="search"
              placeholder="Search texts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="prompt-list">
            <div className="prompt-list__inner">
              {loadingTexts || loadingFolders ? (
                <div className="empty">Loading…</div>
              ) : hasSearch && texts.length === 0 ? (
                <div className="empty">No matching texts.</div>
              ) : texts.length === 0 && folders.length === 0 ? (
                <div className="empty">No texts yet.</div>
              ) : (
                <>
                  {(entriesByParent.get(null) ?? []).map((entry) =>
                    entry.kind === "folder"
                      ? renderFolder(entry.item)
                      : renderTextItem(entry.item)
                  )}
                </>
              )}
            </div>
          </div>
          <div className="sidebar__footer">
            <button
              className="icon-button"
              onClick={handleNewFolder}
              aria-label="New folder"
              title="New folder"
              type="button"
            >
              <span className="icon-button__glyph" aria-hidden="true">📁</span>
            </button>
            <button
              className="icon-button"
              onClick={handleNewText}
              aria-label="New text"
              title="New text"
              type="button"
            >
              <span className="icon-button__glyph" aria-hidden="true">✚</span>
            </button>
            <button
              className="icon-button"
              onClick={handleOpenText}
              aria-label="Open text"
              title="Open text"
              type="button"
            >
              <span className="icon-button__glyph" aria-hidden="true">⤓</span>
            </button>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings"
              type="button"
            >
              <span className="icon-button__glyph icon-button__glyph--large" aria-hidden="true">⚙</span>
            </button>
            <button
              className="icon-button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              type="button"
            >
              <span className="icon-button__glyph" aria-hidden="true">◀</span>
            </button>
          </div>
        </aside>
      ) : null}

      <main className="workspace">
        <div className="workspace__body">
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
                <div className="editor__title-row">
                  <input
                    className="title-input"
                    value={title}
                    onChange={handleTitleChange}
                    onBlur={handleTitleBlur}
                    placeholder="Text title"
                    disabled={isViewingHistory}
                  />
                  <button
                    className={`icon-button${historyOpen ? " is-active" : ""}`}
                    onClick={handleToggleHistory}
                    aria-label={historyOpen ? "Close history" : "Open history"}
                    title={historyOpen ? "Close history" : "Open history"}
                    type="button"
                  >
                    <img src={historyIconSrc} alt="" className="icon-button__img" />
                  </button>
                </div>
              </div>

              <div
                className={`editor__textarea-wrap${
                  markdownPreview ? " editor__textarea-wrap--preview" : ""
                }`}
              >
                {showLineNumbersActive ? (
                  <div className="line-measure" ref={measureRef} aria-hidden="true">
                    {lines.map((line, index) => (
                      <div key={index} className="line-measure__line">
                        {line.length > 0 ? line : " "}
                      </div>
                    ))}
                  </div>
                ) : null}
                {showLineNumbersActive ? (
                  <div className="line-numbers" ref={lineNumbersRef}>
                    {lineNumbers.map((line, index) => (
                      <div
                        key={line}
                        className="line-numbers__line"
                        style={{ height: lineHeights[index] ? `${lineHeights[index]}px` : undefined }}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
                {markdownPreview ? (
                  <div
                    className="markdown-preview md-root"
                    dangerouslySetInnerHTML={{ __html: markdownToHTML(body) }}
                    onClick={handleMarkdownPreviewClick}
                  />
                ) : (
                  <textarea
                    ref={textareaRef}
                    className="editor__textarea"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    onScroll={handleTextareaScroll}
                    placeholder="Write your text here…"
                    readOnly={isViewingHistory}
                  />
                )}
              </div>

              <div className="editor__footer">
                {sidebarCollapsed ? (
                  <button
                    className="icon-button"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                    type="button"
                  >
                    <span className="icon-button__glyph" aria-hidden="true">▶</span>
                  </button>
                ) : null}
                {hasText ? (
                  <>
                    <button
                      className="button"
                      type="button"
                      onClick={() => setMarkdownPreview((value) => !value)}
                    >
                      {markdownPreview ? "Edit" : "Preview Markdown"}
                    </button>
                    <button className="button" onClick={handleExportText}>
                      Export Text
                    </button>
                    {markdownPreview ? (
                      <>
                        <button className="button" type="button" onClick={handlePrintMarkdown}>
                          Print
                        </button>
                      </>
                    ) : null}
                  </>
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
                <div className="editor__footer-status">
                  <div className="status-line">
                    <span className={`status status--${statusKey}`}></span>
                    {statusLabel}
                  </div>
                </div>
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
        </div>
      </main>

      {settingsOpen ? (
        <div className="settings-overlay">
          <div
            className="settings-overlay__backdrop"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="settings-panel" role="dialog" aria-modal="true">
            <div className="settings-panel__header">
              <div className="settings-panel__title">Settings</div>
              <button
                className="icon-button icon-button--ghost"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                title="Close settings"
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="settings-panel__section">
              <label className="settings-panel__label" htmlFor="theme-select">
                Theme
              </label>
              <select
                id="theme-select"
                className="settings-panel__select"
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value as "default" | "light")
                }
              >
                <option value="default">Default</option>
                <option value="light">Bright</option>
              </select>
            </div>
            <div className="settings-panel__section settings-panel__section--row">
              <label className="settings-panel__label" htmlFor="line-numbers-toggle">
                Line numbers
              </label>
              <input
                id="line-numbers-toggle"
                type="checkbox"
                checked={showLineNumbers}
                onChange={(event) => setShowLineNumbers(event.target.checked)}
              />
            </div>
            <div className="settings-panel__section">
              <label className="settings-panel__label" htmlFor="text-size">
                Text size
              </label>
              <div className="settings-panel__slider-row">
                <input
                  id="text-size"
                  className="settings-panel__range"
                  type="range"
                  min={12}
                  max={18}
                  step={1}
                  value={textSize}
                  onChange={(event) => setTextSize(Number(event.target.value))}
                />
                <div className="settings-panel__value">{textSize}px</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
