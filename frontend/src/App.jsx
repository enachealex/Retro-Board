import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Trash2, Plus, GripVertical, X, Edit2, Check, Moon, Sun, User, Users, Settings, Info, Archive, ChevronDown, ChevronLeft, ChevronRight, LogOut, Eye, EyeOff, MoveRight, Image, UserPlus, UserMinus, Search, Upload, SmilePlus } from "lucide-react";
import "./App.css";
import { useAuth } from "./AuthContext";
import { getApiUrl, getSocketUrl, DEFAULT_COMPANY } from "./config";

const API_URL = getApiUrl();

const authHeaders = (token) => token ? { headers: { Authorization: `Bearer ${token}` } } : {};
const socket = io(getSocketUrl(), { autoConnect: false });

const getInitials = (name) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const AVATAR_COLORS = [
  "#E53935", "#D81B60", "#8E24AA", "#5E35B1",
  "#3949AB", "#1E88E5", "#039BE5", "#00ACC1",
  "#00897B", "#43A047", "#7CB342", "#C0CA33",
  "#F4511E", "#6D4C41", "#546E7A", "#1565C0",
  "#AD1457", "#6A1B9A", "#4527A0", "#283593",
];

const AVATAR_COLORS_DARK = [
  "#EF5350", "#EC407A", "#AB47BC", "#7E57C2",
  "#5C6BC0", "#42A5F5", "#29B6F6", "#26C6DA",
  "#26A69A", "#66BB6A", "#9CCC65", "#D4E157",
  "#FF7043", "#A1887F", "#78909C", "#42A5F5",
  "#EC407A", "#AB47BC", "#7E57C2", "#5C6BC0",
];

const getAvatarColor = (name, dark) => {
  const palette = dark ? AVATAR_COLORS_DARK : AVATAR_COLORS;
  if (!name) return palette[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
};

const BOARD_COLORS = [
  "#FFD1DC", // Pastel Pink
  "#D1FFDC", // Pastel Green
  "#DCD1FF", // Pastel Purple
  "#FFECD1", // Pastel Orange
  "#D1EAFF", // Pastel Blue
  "#FFFFD1", // Pastel Yellow
  "#FFD1D1", // Pastel Red
  "#E8D1FF", // Pastel Lavender
  "#D1FFF2", // Pastel Mint
  "#FDE2E4", // Pastel Peach
];

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 50, color: "red" }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error.toString()}</pre>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => {
  const { user, token, logout, updateUser } = useAuth();
  const isAdmin = user?.is_admin === true;
  const isMaster = user?.is_master === true;
  const isOverlord = user?.is_overlord === true;
  const isSuperUser = isMaster || isOverlord; // Master-level privileges (used for UI permission checks)
  const maxBoards = isSuperUser ? 20 : 10;

  // Helper: is a board visible to the current user?
  const isBoardAllowed = (board) => {
    if (!board) return false;
    if (isSuperUser) return true;
    // Admins and members rely on server-side board_members filtering
    return true;
  };

  const [boards, setBoards] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("retro_boards")) || [];
      // If the cached boards owner doesn't match current user, discard
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return [];
      if (isSuperUser) return stored;
      // Admins and members trust server-side membership filtering
      return stored;
    } catch { return []; }
  });
  const [activeBoard, setActiveBoard] = useState(() => {
    try {
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return null;
      const stored = JSON.parse(localStorage.getItem("retro_active_board"));
      return stored && isBoardAllowed(stored) ? stored : null;
    } catch { return null; }
  });
  const [boardCache, setBoardCache] = useState(() => {
    try {
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return {};
      return JSON.parse(localStorage.getItem("retro_board_cache")) || {};
    } catch { return {}; }
  });
  // Restore columns/cards from cache for the active board to prevent blank flash
  const [columns, setColumns] = useState(() => {
    try {
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return [];
      const cache = JSON.parse(localStorage.getItem("retro_board_cache")) || {};
      const active = JSON.parse(localStorage.getItem("retro_active_board"));
      if (active && cache[active.id]?.columns) return cache[active.id].columns;
    } catch {}
    return [];
  });
  const [cards, setCards] = useState(() => {
    try {
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return [];
      const cache = JSON.parse(localStorage.getItem("retro_board_cache")) || {};
      const active = JSON.parse(localStorage.getItem("retro_active_board"));
      if (active && cache[active.id]?.cards) return cache[active.id].cards;
    } catch {}
    return [];
  });
  const [newBoardName, setNewBoardName] = useState("");
  const [newColName, setNewColName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Start as not-loading if we have cached boards + active board (seamless refresh)
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cachedUser = localStorage.getItem("retro_cache_owner");
      if (cachedUser !== user?.email) return true;
      const cachedBoards = JSON.parse(localStorage.getItem("retro_boards")) || [];
      const cachedActive = JSON.parse(localStorage.getItem("retro_active_board"));
      return !(cachedBoards.length > 0 && cachedActive);
    } catch { return true; }
  });

  // Prevents the "Create Board" modal from flickering on StrictMode double-invoke
  const fetchAbortRef = useRef(null);

  // Ref for auto-scrolling to new columns
  const columnsWrapperRef = useRef(null);
  const userAddedColumn = useRef(false);

  // Track columns with pending delete requests (to prevent WebSocket from restoring them)
  const pendingColumnDeletes = useRef(new Set());

  // Guard: suppress WebSocket card/column updates while a drag is in progress
  const isDraggingRef = useRef(false);
  const pendingBoardUpdate = useRef(null);

  // Ref to track newBoardName for click-outside handler (avoids stale closure)
  const newBoardNameRef = useRef("");

  // Drag-to-pan state
  const isPanning = useRef(false);
  const panStartX = useRef(0);
  const panScrollLeft = useRef(0);

  const handlePanStart = (e) => {
    // Only pan on left-click directly on the wrapper background (not on cards/columns)
    if (e.button !== 0) return;
    if (e.target !== columnsWrapperRef.current) return;
    isPanning.current = true;
    panStartX.current = e.pageX;
    panScrollLeft.current = columnsWrapperRef.current.scrollLeft;
    columnsWrapperRef.current.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const handlePanMove = (e) => {
    if (!isPanning.current) return;
    const dx = e.pageX - panStartX.current;
    columnsWrapperRef.current.scrollLeft = panScrollLeft.current - dx;
  };

  const handlePanEnd = () => {
    if (!isPanning.current) return;
    isPanning.current = false;
    if (columnsWrapperRef.current) {
      columnsWrapperRef.current.style.cursor = '';
    }
  };

  // Hook to persist data seamlessly when page refreshes or unloads
  useEffect(() => {
    const backupState = () => {
      if (activeBoard) {
        try {
          // Save the transient columns and cards directly into cache on refresh
          const currentCache = { ...boardCache, [activeBoard.id]: { columns, cards } };
          localStorage.setItem("retro_board_cache", JSON.stringify(currentCache));
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            console.warn('[RetroBoard] localStorage quota exceeded — clearing board cache');
            localStorage.removeItem("retro_board_cache");
          }
        }
      } else {
        try {
          localStorage.setItem("retro_board_cache", JSON.stringify(boardCache));
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            console.warn('[RetroBoard] localStorage quota exceeded — clearing board cache');
            localStorage.removeItem("retro_board_cache");
          }
        }
      }
      try {
        localStorage.setItem("retro_boards", JSON.stringify(boards));
        localStorage.setItem("retro_active_board", JSON.stringify(activeBoard));
        localStorage.setItem("retro_cache_owner", user?.email || "");
      } catch (e) {
        if (e.name === 'QuotaExceededError') console.warn('[RetroBoard] localStorage quota exceeded saving board list');
      }
    };

    // Save in real-time on every state change safely
    backupState();

    window.addEventListener("beforeunload", backupState);
    return () => window.removeEventListener("beforeunload", backupState);
  }, [activeBoard, columns, cards, boards, boardCache]);

  const [isEditingBoard, setIsEditingBoard] = useState(false);
  const [editBoardName, setEditBoardName] = useState("");
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [bgPickerUrl, setBgPickerUrl] = useState("");
  const bgFileInputRef = useRef(null);

  // Board members panel
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [boardMembers, setBoardMembers] = useState([]);
  const [deptUsersForBoard, setDeptUsersForBoard] = useState([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [pendingInvites, setPendingInvites] = useState([]);
  const [boardInviteUrl, setBoardInviteUrl] = useState("");
  const [boardInviteUrlExpiresAt, setBoardInviteUrlExpiresAt] = useState("");
  const [boardInviteUrlLoading, setBoardInviteUrlLoading] = useState(false);
  const [boardInviteUrlCopied, setBoardInviteUrlCopied] = useState(false);
  const [myPendingBoardInvites, setMyPendingBoardInvites] = useState([]);
  const [inviteRedirectBoardId, setInviteRedirectBoardId] = useState(() => {
    const raw = localStorage.getItem("retro_redirect_board_id");
    return raw ? Number(raw) : null;
  });

  const [inviteTokenFromUrl, setInviteTokenFromUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('invite') || '';
  });

  const [invitePrompt, setInvitePrompt] = useState(null);
  const [inviteActionLoading, setInviteActionLoading] = useState(false);

  // Sidebar panel: "boards" | "users" | "labels"  (users/labels panel only for masters)
  const [sidebarPanel, setSidebarPanel] = useState("boards");
  const [usersList, setUsersList] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [companyFilterOptions, setCompanyFilterOptions] = useState([]);
  const [masterCompanyFilter, setMasterCompanyFilter] = useState(() => user?.company || DEFAULT_COMPANY);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserDept, setEditUserDept] = useState("");
  const [editUserLead, setEditUserLead] = useState("");
  const [editUserFirstName, setEditUserFirstName] = useState("");
  const [editUserLastName, setEditUserLastName] = useState("");

  const effectiveCompanyFilter = isSuperUser
    ? (masterCompanyFilter || user?.company || DEFAULT_COMPANY)
    : (user?.company || DEFAULT_COMPANY);

  // Admin email management (masters)
  const [adminEmails, setAdminEmails] = useState([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminDept, setNewAdminDept] = useState("QA");

  // Master email management (masters)
  const [masterEmails, setMasterEmails] = useState([]);
  const [newMasterEmail, setNewMasterEmail] = useState("");

  const fetchAdminEmails = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin-emails`, authHeaders(token));
      setAdminEmails(res.data);
    } catch (e) { console.error('Error fetching admin emails', e); }
  };

  const addAdminEmail = async () => {
    if (!newAdminEmail.trim()) return;
    try {
      await axios.post(`${API_URL}/admin-emails`, { email: newAdminEmail.trim(), department: newAdminDept }, authHeaders(token));
      setNewAdminEmail("");
      fetchAdminEmails();
    } catch (e) {
      console.error('Error adding admin email', e);
    }
  };

  const removeAdminEmail = async (id) => {
    try {
      await axios.delete(`${API_URL}/admin-emails/${id}`, authHeaders(token));
      fetchAdminEmails();
    } catch (e) { console.error('Error removing admin email', e); }
  };

  const updateAdminEmailDept = async (id, department) => {
    try {
      await axios.patch(`${API_URL}/admin-emails/${id}`, { department }, authHeaders(token));
      fetchAdminEmails();
    } catch (e) { console.error('Error updating admin email dept', e); }
  };

  const fetchMasterEmails = async () => {
    try {
      const res = await axios.get(`${API_URL}/master-emails`, authHeaders(token));
      setMasterEmails(res.data);
    } catch (e) { console.error('Error fetching master emails', e); }
  };

  const addMasterEmail = async () => {
    if (!newMasterEmail.trim()) return;
    try {
      await axios.post(`${API_URL}/master-emails`, { email: newMasterEmail.trim() }, authHeaders(token));
      setNewMasterEmail("");
      fetchMasterEmails();
    } catch (e) {
      console.error('Error adding master email', e);
    }
  };

  const removeMasterEmail = async (id) => {
    try {
      await axios.delete(`${API_URL}/master-emails/${id}`, authHeaders(token));
      fetchMasterEmails();
    } catch (e) { console.error('Error removing master email', e); }
  };

  // Role labels (configurable by masters)
  const DEFAULT_LABELS = { master: 'Iron Fist', admin: 'Admin', user: 'Member' };
  const [roleLabels, setRoleLabels] = useState(DEFAULT_LABELS);
  const [editingLabels, setEditingLabels] = useState(null); // copy being edited
  const [newLabelKey, setNewLabelKey] = useState("");
  const [newLabelVal, setNewLabelVal] = useState("");

  const roleLabelParams = isSuperUser ? { company: effectiveCompanyFilter } : undefined;

  const fetchRoleLabels = async () => {
    try {
      const res = await axios.get(`${API_URL}/role-labels`, {
        ...authHeaders(token),
        params: roleLabelParams,
      });
      setRoleLabels({ ...DEFAULT_LABELS, ...res.data });
    } catch (e) { console.error("Error fetching role labels", e); }
  };

  const saveRoleLabels = async () => {
    try {
      await axios.put(`${API_URL}/role-labels`, { labels: editingLabels }, {
        ...authHeaders(token),
        params: roleLabelParams,
      });
      setRoleLabels(editingLabels);
      setEditingLabels(null);
    } catch (e) { console.error("Error saving role labels", e); }
  };

  const addRoleLabel = async () => {
    const key = newLabelKey.trim();
    const val = newLabelVal.trim();
    if (!key || !val) return;
    try {
      await axios.post(`${API_URL}/role-labels`, { role_key: key, label: val }, {
        ...authHeaders(token),
        params: roleLabelParams,
      });
      const updated = { ...roleLabels, [key.toLowerCase().replace(/\s+/g, '_')]: val };
      setRoleLabels(updated);
      setNewLabelKey(""); setNewLabelVal("");
    } catch (e) { console.error("Error adding role label", e); }
  };

  const deleteRoleLabel = async (key) => {
    try {
      await axios.delete(`${API_URL}/role-labels/${key}`, {
        ...authHeaders(token),
        params: roleLabelParams,
      });
      setRoleLabels(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e) { console.error("Error deleting role label", e); }
  };

  const [leadsByDept, setLeadsByDept] = useState({});

  const fetchLeads = async () => {
    try {
      const res = await axios.get(`${API_URL}/leads`, { params: { company: effectiveCompanyFilter || '' } });
      setLeadsByDept(res.data);
    } catch (e) { console.error("Error fetching leads", e); }
  };

  useEffect(() => { if (token) fetchLeads(); }, [token, effectiveCompanyFilter]);

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await axios.get(`${API_URL}/users`, {
        ...authHeaders(token),
        params: isSuperUser ? { company: effectiveCompanyFilter } : undefined,
      });
      setUsersList(res.data);
    } catch (e) { console.error("Error fetching users", e); }
    finally { setUsersLoading(false); }
  };

  const fetchCompanyFilterOptions = async () => {
    try {
      const res = await axios.get(`${API_URL}/companies`);
      const options = Array.isArray(res.data) ? res.data.filter(Boolean) : [];
      setCompanyFilterOptions(options);
    } catch (e) {
      console.error("Error fetching companies", e);
      setCompanyFilterOptions([]);
    }
  };

  useEffect(() => {
    if (!isSuperUser) return;
    fetchCompanyFilterOptions();
  }, [isSuperUser]);

  useEffect(() => {
    if (!isSuperUser || !user?.company) return;
    setMasterCompanyFilter((prev) => prev || user.company);
  }, [isSuperUser, user?.company]);

  useEffect(() => {
    if (!isSuperUser) return;
    fetchBoards();
    if (sidebarPanel === "users") {
      fetchUsers();
    }
  }, [isSuperUser, effectiveCompanyFilter]);

  // Board membership management
  const fetchBoardMembers = async (boardId) => {
    if (!boardId) return;
    try {
      const res = await axios.get(`${API_URL}/boards/${boardId}/members`, authHeaders(token));
      setBoardMembers(res.data || []);
    } catch (e) { console.error("Error fetching board members", e); }
  };

  const fetchPendingInvites = async (boardId) => {
    if (!boardId) return;
    try {
      const res = await axios.get(`${API_URL}/boards/${boardId}/pending-invites`, authHeaders(token));
      setPendingInvites(res.data || []);
    } catch (e) {
      console.error("Error fetching pending invites", e);
      setPendingInvites([]);
    }
  };

  const fetchBoardInviteUrl = async (boardId) => {
    if (!boardId) {
      setBoardInviteUrl("");
      setBoardInviteUrlExpiresAt("");
      return;
    }
    setBoardInviteUrlLoading(true);
    try {
      const res = await axios.get(`${API_URL}/boards/${boardId}/invite-link`, authHeaders(token));
      setBoardInviteUrl(res.data?.inviteUrl || "");
      setBoardInviteUrlExpiresAt(res.data?.inviteUrlExpiresAt || "");
    } catch (e) {
      console.error("Error fetching board invite URL", e);
      setBoardInviteUrl("");
      setBoardInviteUrlExpiresAt("");
    } finally {
      setBoardInviteUrlLoading(false);
    }
  };

  const fetchMyPendingBoardInvites = async () => {
    try {
      const res = await axios.get(`${API_URL}/invites/me/pending`, authHeaders(token));
      setMyPendingBoardInvites(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("Error fetching my pending board invites", e);
      setMyPendingBoardInvites([]);
    }
  };

  const fetchDeptUsersForBoard = async () => {
    try {
      const res = await axios.get(`${API_URL}/users`, {
        ...authHeaders(token),
        params: isSuperUser ? { company: effectiveCompanyFilter } : undefined,
      });
      setDeptUsersForBoard(res.data || []);
    } catch (e) { console.error("Error fetching users for board", e); }
  };

  const addBoardMember = async (boardId, userId) => {
    try {
      await axios.post(`${API_URL}/boards/${boardId}/invites`, { userId }, authHeaders(token));
      fetchBoardMembers(boardId);
      fetchPendingInvites(boardId);
      fetchBoardUsers(boardId);
      fetchMyPendingBoardInvites();
    } catch (e) { console.error("Error adding board member", e); }
  };

  const removeBoardMember = async (boardId, userId) => {
    try {
      await axios.delete(`${API_URL}/boards/${boardId}/members/${userId}`, authHeaders(token));
      setBoardMembers(prev => prev.filter(m => m.id !== userId));
      if (activeBoard) fetchBoardUsers(activeBoard.id);
    } catch (e) { console.error("Error removing board member", e); }
  };

  const openMembersPanel = () => {
    if (!activeBoard) return;
    setShowMembersPanel(true);
    setMemberSearchQuery("");
    fetchBoardInviteUrl(activeBoard.id);
    fetchBoardMembers(activeBoard.id);
    fetchPendingInvites(activeBoard.id);
    fetchDeptUsersForBoard();
  };

  const cancelPendingInvite = async (boardId, inviteId) => {
    try {
      await axios.delete(`${API_URL}/boards/${boardId}/invites/${inviteId}`, authHeaders(token));
      fetchPendingInvites(boardId);
      fetchBoardUsers(boardId);
      fetchMyPendingBoardInvites();
    } catch (e) {
      console.error("Error canceling invite", e);
    }
  };

  const fetchBoardUsers = async (boardId) => {
    if (!boardId) return;
    try {
      const res = await axios.get(`${API_URL}/boards/${boardId}/users`, authHeaders(token));
      setBoardUsersList(res.data || []);
    } catch (e) { console.error("Error fetching board users", e); }
  };

  const toggleBoardUsersDropdown = (e) => {
    e.stopPropagation();
    if (!isBoardUsersOpen && activeBoard) {
      fetchBoardUsers(activeBoard.id);
    }
    setIsBoardUsersOpen(!isBoardUsersOpen);
  };

  const saveUserEdit = async (userId) => {
    try {
      const firstName = editUserFirstName.trim();
      const lastName = editUserLastName.trim();
      await axios.patch(`${API_URL}/users/${userId}`, { department: editUserDept, lead: editUserLead, first_name: firstName, last_name: lastName }, authHeaders(token));
      const displayName = [firstName, lastName].filter(Boolean).join(' ');
      setUsersList(prev => prev.map(u => u.id === userId ? { ...u, department: editUserDept, lead: editUserLead, first_name: firstName, last_name: lastName, display_name: displayName || u.display_name } : u));
    } catch (e) { console.error("Error updating user", e); }
    setEditingUserId(null);
  };

  const deleteUser = async (userId) => {
    try {
      await axios.delete(`${API_URL}/users/${userId}`, authHeaders(token));
      setUsersList(prev => prev.filter(u => u.id !== userId));
    } catch (e) { console.error("Error deleting user", e); }
  };

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFirstName, setSettingsFirstName] = useState("");
  const [settingsLastName, setSettingsLastName] = useState("");
  const [settingsCurPw, setSettingsCurPw] = useState("");
  const [settingsNewPw, setSettingsNewPw] = useState("");
  const [settingsConfirmPw, setSettingsConfirmPw] = useState("");
  const [settingsShowCurPw, setSettingsShowCurPw] = useState(false);
  const [settingsShowNewPw, setSettingsShowNewPw] = useState(false);
  const [settingsEditingName, setSettingsEditingName] = useState(false);
  const [settingsEditingPw, setSettingsEditingPw] = useState(false);

  // Reusable confirm dialog
  // { message, onConfirm } — null when hidden
  const [confirmDialog, setConfirmDialog] = useState(null);
  const showConfirm = (message, onConfirm) => setConfirmDialog({ message, onConfirm });
  const [settingsMsg, setSettingsMsg] = useState(null); // { type: 'success'|'error', text }

  const openSettings = () => {
    setSettingsFirstName(""); setSettingsLastName("");
    setSettingsCurPw(""); setSettingsNewPw(""); setSettingsConfirmPw("");
    setSettingsShowCurPw(false); setSettingsShowNewPw(false);
    setSettingsEditingName(false); setSettingsEditingPw(false);
    setSettingsMsg(null);
    setShowSettings(true);
    setIsProfileOpen(false);
  };

  const saveProfile = async () => {
    if (!settingsFirstName.trim() || !settingsLastName.trim()) {
      setSettingsMsg({ type: "error", text: "First and last name are required." }); return;
    }
    try {
      const res = await axios.patch(`${API_URL}/auth/profile`, { firstName: settingsFirstName.trim(), lastName: settingsLastName.trim() }, authHeaders(token));
      updateUser({ first_name: settingsFirstName.trim(), last_name: settingsLastName.trim(), display_name: `${settingsFirstName.trim()} ${settingsLastName.trim()}` });
      setSettingsMsg({ type: "success", text: "Name updated successfully." });
      setSettingsEditingName(false);
    } catch (e) {
      setSettingsMsg({ type: "error", text: e.response?.data?.error || "Failed to update profile." });
    }
  };

  const savePassword = async () => {
    if (!settingsCurPw || !settingsNewPw) {
      setSettingsMsg({ type: "error", text: "All password fields are required." }); return;
    }
    if (settingsNewPw.length < 6) {
      setSettingsMsg({ type: "error", text: "New password must be at least 6 characters." }); return;
    }
    if (settingsNewPw !== settingsConfirmPw) {
      setSettingsMsg({ type: "error", text: "Passwords do not match." }); return;
    }
    try {
      await axios.patch(`${API_URL}/auth/password`, { currentPassword: settingsCurPw, newPassword: settingsNewPw }, authHeaders(token));
      setSettingsCurPw(""); setSettingsNewPw(""); setSettingsConfirmPw("");
      setSettingsEditingPw(false);
      setSettingsMsg({ type: "success", text: "Password changed. Please sign in again." });
      setTimeout(() => logout(), 1800);
    } catch (e) {
      setSettingsMsg({ type: "error", text: e.response?.data?.error || "Failed to change password." });
    }
  };

  const deleteOwnAccount = async () => {
    try {
      await axios.delete(`${API_URL}/auth/account`, authHeaders(token));
      logout();
    } catch (e) {
      setSettingsMsg({ type: "error", text: e.response?.data?.error || "Failed to delete account." });
    }
  };

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [editingColumnId, setEditingColumnId] = useState(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [hoveredColumnId, setHoveredColumnId] = useState(null);
  const [isCreatingBoardInline, setIsCreatingBoardInline] = useState(false);
  const isCreatingBoardInlineRef = useRef(false);
  const inlineBoardFormRef = useRef(null);
  const [addingCardToColId, setAddingCardToColId] = useState(null);
  const [newCardContent, setNewCardContent] = useState("");
  const [newCardImageUrl, setNewCardImageUrl] = useState("");

  // --- GIF Library State ---
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifPickerContext, setGifPickerContext] = useState(null); // 'new-card' | { editCardId }
  const gifJustClosedRef = useRef(false); // prevents add-card from closing right after GIF selection
  const [showGifLibrary, setShowGifLibrary] = useState(false);
  const [gifList, setGifList] = useState([]);
  const [gifSearch, setGifSearch] = useState("");
  const [gifPage, setGifPage] = useState(1);
  const [gifTotal, setGifTotal] = useState(0);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifTab, setGifTab] = useState('all'); // 'all' | 'custom'
  const [gifAddUrl, setGifAddUrl] = useState("");
  const [gifAddTitle, setGifAddTitle] = useState("");
  const [gifUploadPending, setGifUploadPending] = useState(null);
  const [gifUploadTitle, setGifUploadTitle] = useState("");
  const gifUploadRef = useRef(null);
  const gifSearchTimeout = useRef(null);
  const newCardContentRef = useRef("");
  const newCardImageUrlRef = useRef("");
  const cardImageInputRef = useRef(null);
  const addCardFormRef = useRef(null);
  const [editingCardId, setEditingCardId] = useState(null);
  const [editCardContent, setEditCardContent] = useState("");
  const editCardContentRef = useRef("");
  const [reactionPickerCardId, setReactionPickerCardId] = useState(null);
  const [reactionPickerPos, setReactionPickerPos] = useState(null);
  const REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '🚀', '🔥', '👀', '💯'];

  // --- GIF Library Functions ---
  const fetchGifs = useCallback(async (search = '', page = 1, filter = 'all') => {
    setGifLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 12 });
      if (search.trim()) params.set('search', search.trim());
      if (filter && filter !== 'all') params.set('filter', filter);
      const res = await axios.get(`${API_URL}/gifs?${params}`, authHeaders(token));
      setGifList(res.data.gifs);
      setGifTotal(res.data.total);
      setGifPage(res.data.page);
    } catch (err) { console.error('Failed to fetch GIFs', err); }
    setGifLoading(false);
  }, [token]);

  const openGifPicker = (context) => {
    setGifPickerContext(context);
    setShowGifPicker(true);
    setGifSearch('');
    setGifPage(1);
    setGifTab('all');
    fetchGifs('', 1, 'all');
  };

  const selectGif = (gif) => {
    const fullUrl = gif.url.startsWith('/') ? `${API_URL.replace('/api', '')}${gif.url}` : gif.url;
    if (gifPickerContext === 'new-card') {
      setNewCardImageUrl(fullUrl);
      // Close the picker but keep the add-card form open
      setShowGifPicker(false);
      setGifPickerContext(null);
      // Briefly suppress the mousedown handler from closing the add-card form
      gifJustClosedRef.current = true;
      setTimeout(() => {
        gifJustClosedRef.current = false;
        if (addCardFormRef.current) {
          const input = addCardFormRef.current.querySelector('textarea, input');
          if (input) input.focus();
        }
      }, 100);
      return;
    } else if (gifPickerContext && gifPickerContext.editCardId) {
      const cardId = gifPickerContext.editCardId;
      setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, image_url: fullUrl } : c));
      if (!String(cardId).startsWith('temp-')) {
        axios.put(`${API_URL}/cards/${cardId}`, { image_url: fullUrl }, authHeaders(token)).catch(err => console.error('Error updating card image', err));
      }
    }
    setShowGifPicker(false);
    setGifPickerContext(null);
  };

  const openGifLibrary = () => {
    setShowGifLibrary(true);
    setGifSearch('');
    setGifPage(1);
    setGifTab('all');
    setGifAddUrl('');
    setGifAddTitle('');
    fetchGifs('', 1, 'all');
  };

  const addGifByUrl = async () => {
    if (!gifAddUrl.trim()) return;
    if (!gifAddTitle.trim()) { alert('Please enter a name for the GIF.'); return; }
    try {
      await axios.post(`${API_URL}/gifs`, { url: gifAddUrl.trim(), title: gifAddTitle.trim() }, authHeaders(token));
      setGifAddUrl('');
      setGifAddTitle('');
      fetchGifs(gifSearch, gifPage, gifTab);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add GIF');
    }
  };

  const uploadGifFile = async (file, title) => {
    if (!title || !title.trim()) { alert('Please enter a name for the GIF.'); return; }
    const formData = new FormData();
    formData.append('gif', file);
    formData.append('title', title.trim());
    try {
      await axios.post(`${API_URL}/gifs/upload`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      setGifUploadPending(null);
      setGifUploadTitle('');
      fetchGifs(gifSearch, gifPage, gifTab);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to upload GIF');
    }
  };

  const deleteGif = async (gifId) => {
    try {
      await axios.delete(`${API_URL}/gifs/${gifId}`, authHeaders(token));
      fetchGifs(gifSearch, gifPage, gifTab);
    } catch (err) { console.error('Failed to delete GIF', err); }
  };

  // Upload an image file (from paste or file picker) and return the full URL
  const uploadImageFile = async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    const res = await axios.post(`${API_URL}/upload`, formData, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
    });
    return `${API_URL.replace('/api', '')}${res.data.url}`;
  };

  // Check if a string is an image URL
  const isImageUrl = (str) => {
    if (!str) return false;
    const trimmed = str.trim();
    try {
      const url = new URL(trimmed);
      if (!/^https?:$/.test(url.protocol)) return false;
      const path = url.pathname.toLowerCase();
      return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?.*)?$/i.test(path);
    } catch { return false; }
  };

  // Handle paste on the new-card textarea — if clipboard has an image file or image URL
  const handleNewCardPaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Check for image file first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const url = await uploadImageFile(file);
          setNewCardImageUrl(url);
        } catch (err) { console.error('Paste upload failed', err); }
        return;
      }
    }
    // Check for pasted text that is an image URL
    const text = e.clipboardData?.getData('text/plain');
    if (text && isImageUrl(text)) {
      e.preventDefault();
      setNewCardImageUrl(text.trim());
    }
  };

  // Handle paste on an existing card — image file or image URL
  const handleCardPaste = async (e, cardId) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Check for image file first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const url = await uploadImageFile(file);
          setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, image_url: url } : c));
          if (!String(cardId).startsWith('temp-')) {
            await axios.put(`${API_URL}/cards/${cardId}`, { image_url: url }, authHeaders(token));
          }
        } catch (err) { console.error('Paste upload failed', err); }
        return;
      }
    }
    // Check for pasted text that is an image URL
    const text = e.clipboardData?.getData('text/plain');
    if (text && isImageUrl(text)) {
      e.preventDefault();
      const url = text.trim();
      setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, image_url: url } : c));
      if (!String(cardId).startsWith('temp-')) {
        await axios.put(`${API_URL}/cards/${cardId}`, { image_url: url }, authHeaders(token));
      }
    }
  };
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    return localStorage.getItem("retro_board_theme") === "dark";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem("retro_sidebar_collapsed");
    if (stored !== null) return stored === "true";
    return true;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = parseInt(localStorage.getItem("retro_sidebar_width"));
    return stored && stored >= 180 && stored <= 500 ? stored : 250;
  });
  const [sidebarFontSize, setSidebarFontSize] = useState(() => {
    const stored = parseInt(localStorage.getItem("retro_sidebar_fontsize"));
    return stored && stored >= 100 && stored <= 150 ? stored : 100;
  });
  const [showFontSlider, setShowFontSlider] = useState(false);
  const isResizingSidebar = useRef(false);

  // User Profile Dropdown
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Board User List Dropdown
  const [isBoardUsersOpen, setIsBoardUsersOpen] = useState(false);
  const [boardUsersList, setBoardUsersList] = useState([]);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [expandedDepts, setExpandedDepts] = useState({});

  // Clamp context menu within viewport after render
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (rect.bottom > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (rect.right > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.top = y + 'px';
      el.style.left = x + 'px';
    }
  }, [contextMenu]);

  // Archived items
  const [archivedCards, setArchivedCards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("retro_archived_cards")) || []; }
    catch { return []; }
  });
  const [archivedColumns, setArchivedColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem("retro_archived_columns")) || []; }
    catch { return []; }
  });

  // Persist archived items
  useEffect(() => {
    try { localStorage.setItem("retro_archived_cards", JSON.stringify(archivedCards)); }
    catch (e) { if (e.name === 'QuotaExceededError') localStorage.removeItem("retro_archived_cards"); }
  }, [archivedCards]);
  useEffect(() => {
    try { localStorage.setItem("retro_archived_columns", JSON.stringify(archivedColumns)); }
    catch (e) { if (e.name === 'QuotaExceededError') localStorage.removeItem("retro_archived_columns"); }
  }, [archivedColumns]);

  // Close context menu and profile dropdown on outside click
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setExpandedDepts({});
      setIsProfileOpen(false);
      setIsBoardUsersOpen(false);
      setShowFontSlider(false);
      setReactionPickerCardId(null);
      setReactionPickerPos(null);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Suppress the browser's default right-click menu everywhere on the page
  useEffect(() => {
    const suppress = (e) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  // Auto-scroll to new column only when user actively adds one
  useEffect(() => {
    if (userAddedColumn.current && columnsWrapperRef.current) {
      columnsWrapperRef.current.scrollTo({
        left: columnsWrapperRef.current.scrollWidth,
        behavior: "smooth",
      });
      userAddedColumn.current = false;
    }
  }, [columns.length]);

  // Apply a board:update payload (extracted so it can be called immediately or deferred)
  const applyBoardUpdate = (data) => {
    if (data.columns) {
      const pending = pendingColumnDeletes.current;
      if (pending.size > 0) {
        const serverColIds = new Set(data.columns.map((c) => c.id));
        for (const pid of pending) {
          if (!serverColIds.has(pid)) pending.delete(pid);
        }
      }
      const cols = pending.size > 0
        ? data.columns.filter((c) => !pending.has(c.id))
        : data.columns;
      setColumns(cols);
    }
    if (data.cards) {
      setCards((prev) => {
        const tempCards = prev.filter((c) => String(c.id).startsWith("temp-"));
        const serverIds = new Set(data.cards.map((c) => c.id));
        const survivingTemps = tempCards.filter((t) => !serverIds.has(t.id));
        return [...data.cards, ...survivingTemps];
      });
    }
  };

  // Apply the most recent deferred board:update after a drag finishes
  const flushPendingBoardUpdate = () => {
    const data = pendingBoardUpdate.current;
    if (data) {
      pendingBoardUpdate.current = null;
      applyBoardUpdate(data);
    }
  };

  // WebSocket real-time sync — only update when new data comes in
  useEffect(() => {
    socket.connect();

    // Register this socket with the user's ID so the server can send targeted events
    if (user?.id) {
      socket.emit('register:user', user.id);
    }

    // Join the room for the active board so we only receive its updates
    if (activeBoard?.id) {
      socket.emit('join:board', activeBoard.id);
    }

    socket.on("board:update", (data) => {
      if (data.boardId && activeBoard && Number(data.boardId) === Number(activeBoard.id)) {
        // Defer updates while a drag is in progress to prevent snap-back
        if (isDraggingRef.current) {
          pendingBoardUpdate.current = data;
          return;
        }
        applyBoardUpdate(data);
      }
    });

    socket.on("boards:update", (data) => {
      if (data.boards) {
        const incomingBoards = Array.isArray(data.boards) ? data.boards : [];
        const scopedBoards = isSuperUser
          ? incomingBoards.filter(b => (b.company || DEFAULT_COMPANY) === effectiveCompanyFilter)
          : incomingBoards;
        if (isSuperUser) {
          const allowed = scopedBoards.filter(isBoardAllowed);
          setBoards(allowed);
          if (activeBoard) {
            const updated = allowed.find(b => b.id === activeBoard.id);
            if (updated) setActiveBoard(prev => ({ ...prev, ...updated }));
          }
        } else {
          // Admins and members: sync activeBoard immediately from broadcast, then refetch full list
          if (activeBoard) {
            const updated = incomingBoards.find(b => b.id === activeBoard.id);
            if (updated) setActiveBoard(prev => ({ ...prev, bg_image: updated.bg_image, name: updated.name }));
          }
          fetchBoards();
        }
      }
    });

    // Targeted refresh when this user is added/removed from a board
    socket.on("boards:refresh", () => {
      fetchBoards();
      fetchMyPendingBoardInvites();
    });

    return () => {
      if (activeBoard?.id) {
        socket.emit('leave:board', activeBoard.id);
      }
      socket.off("board:update");
      socket.off("boards:update");
      socket.off("boards:refresh");
      socket.disconnect();
    };
  }, [activeBoard?.id, isSuperUser, isAdmin, user?.lead, effectiveCompanyFilter]);

  // Invite deep-link prompt (opened after sign-in)
  useEffect(() => {
    if (!token) return;
    if (!inviteTokenFromUrl) return;

    const clearInviteQueryParam = () => {
      const clean = new URLSearchParams(window.location.search);
      clean.delete('invite');
      const qs = clean.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      setInviteTokenFromUrl('');
    };

    const loadInvite = async () => {
      try {
        const res = await axios.get(`${API_URL}/invites/${encodeURIComponent(inviteTokenFromUrl)}`);
        const payload = { ...res.data, token: inviteTokenFromUrl };
        if (payload.status === 'ACCEPTED' && payload.boardId) {
          setInviteRedirectBoardId(Number(payload.boardId));
          localStorage.setItem("retro_redirect_board_id", String(payload.boardId));
          clearInviteQueryParam();
          return;
        }
        setInvitePrompt(payload);
      } catch (e) {
        console.error('Failed to load invite', e);
      }
    };

    loadInvite();
  }, [token, inviteTokenFromUrl]);

  useEffect(() => {
    const syncInviteToken = () => {
      const params = new URLSearchParams(window.location.search);
      setInviteTokenFromUrl(params.get('invite') || '');
    };

    window.addEventListener('popstate', syncInviteToken);
    window.addEventListener('hashchange', syncInviteToken);
    return () => {
      window.removeEventListener('popstate', syncInviteToken);
      window.removeEventListener('hashchange', syncInviteToken);
    };
  }, []);

  const respondToInvite = async (decision) => {
    if (!invitePrompt?.token) return;
    setInviteActionLoading(true);
    try {
      const res = await axios.post(`${API_URL}/invites/${encodeURIComponent(invitePrompt.token)}/respond`, { decision }, authHeaders(token));
      if (decision === 'accept' && res.data?.boardId) {
        const nextBoardId = Number(res.data.boardId);
        setInviteRedirectBoardId(nextBoardId);
        localStorage.setItem("retro_redirect_board_id", String(nextBoardId));
      }
      await fetchBoards();
      await fetchMyPendingBoardInvites();
      if (activeBoard?.id) {
        fetchBoardUsers(activeBoard.id);
        fetchBoardMembers(activeBoard.id);
        fetchPendingInvites(activeBoard.id);
      }
    } catch (e) {
      console.error('Failed to respond to invite', e);
      alert(e.response?.data?.error || 'Failed to process invite response');
    } finally {
      const params = new URLSearchParams(window.location.search);
      params.delete('invite');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      setInviteTokenFromUrl('');
      setInvitePrompt(null);
      setInviteActionLoading(false);
    }
  };

  // Apply dark theme class to body and save preference
  useEffect(() => {
    if (isDarkTheme) {
      document.body.classList.add("dark-theme");
      localStorage.setItem("retro_board_theme", "dark");
    } else {
      document.body.classList.remove("dark-theme");
      localStorage.setItem("retro_board_theme", "light");
    }
  }, [isDarkTheme]);

  // Fetch all boards on mount
  useEffect(() => {
    fetchBoards();
    fetchMyPendingBoardInvites();
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchRoleLabels();
  }, [token, effectiveCompanyFilter, isSuperUser]);

  useEffect(() => {
    if (!activeBoard?.id) {
      setBoardInviteUrl("");
      setBoardInviteUrlExpiresAt("");
      return;
    }
    if (showMembersPanel) {
      fetchBoardInviteUrl(activeBoard.id);
    }
  }, [activeBoard?.id, showMembersPanel]);

  useEffect(() => {
    if (!inviteRedirectBoardId || !boards.length) return;
    const target = boards.find(b => Number(b.id) === Number(inviteRedirectBoardId));
    if (target) {
      setActiveBoard(target);
      localStorage.removeItem("retro_redirect_board_id");
      setInviteRedirectBoardId(null);
    }
  }, [boards, inviteRedirectBoardId]);

  // Fetch specific board data when activeBoard changes
  useEffect(() => {
    if (activeBoard && !String(activeBoard.id).startsWith('temp-board-')) {
      fetchBoardData(activeBoard.id);
    }
  }, [activeBoard?.id]);

  const handleBoardClick = (b) => {
    if (activeBoard && activeBoard.id === b.id) return;

    if (activeBoard) {
      // Save current board's data to cache before switching
      setBoardCache((prev) => ({
        ...prev,
        [activeBoard.id]: { columns: [...columns], cards: [...cards] },
      }));
    }

    // Clear current data immediately to prevent bleed
    setColumns([]);
    setCards([]);
    setActiveBoard(b);
  };

  const fetchBoards = async () => {
    // Cancel any in-flight fetch (handles React StrictMode double-invoke)
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setIsLoading(true);
    try {
      const res = await axios.get(`${API_URL}/boards`, {
        ...authHeaders(token),
        params: isSuperUser ? { company: effectiveCompanyFilter } : undefined,
        signal: controller.signal,
      });
      // Client-side guard: only keep boards this user is allowed to see
      const boardsPayload = Array.isArray(res.data) ? res.data : [];
      if (!Array.isArray(res.data)) {
        console.error("Unexpected boards payload", res.data);
      }
      const allowed = boardsPayload.filter(isBoardAllowed);
      setBoards(allowed);
      if (allowed.length > 0) {
        if (!activeBoard || !allowed.find(b => b.id === activeBoard.id)) {
          setActiveBoard(allowed[0]);
        } else {
          const fresh = allowed.find(b => b.id === activeBoard.id);
          if (fresh) setActiveBoard(prev => ({ ...prev, bg_image: fresh.bg_image, name: fresh.name }));
        }
      } else {
        setActiveBoard(null);
      }
    } catch (error) {
      if (axios.isCancel(error) || error.name === 'CanceledError') return; // stale call
      console.error("Error fetching boards:", error);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  const createBoard = async (template = 'blank') => {
    if (!newBoardName.trim()) {
      setIsCreatingBoardInline(false);
      return;
    }
    if (boards.length >= maxBoards) {
      alert(`You have reached the maximum limit of ${maxBoards} boards.`);
      setIsCreatingBoardInline(false);
      return;
    }

    // Save current board data to cache before switching away!
    if (activeBoard) {
      setBoardCache((prev) => ({
        ...prev,
        [activeBoard.id]: { columns: [...columns], cards: [...cards] },
      }));
    }

    // Let's create it locally immediately without needing the DB to confirm!
    const tempBoardId = `temp-board-${Date.now()}`;
    const newBoard = { id: tempBoardId, name: newBoardName };
    const defaultColumns = template === 'template'
      ? [
          { id: `temp-col-1`, board_id: tempBoardId, name: "Ice Breaker", position: 0 },
          { id: `temp-col-2`, board_id: tempBoardId, name: "Needs Improvements", position: 1 },
          { id: `temp-col-3`, board_id: tempBoardId, name: "Went Well", position: 2 },
          { id: `temp-col-4`, board_id: tempBoardId, name: "Action Items", position: 3 },
        ]
      : [
          { id: `temp-col-1`, board_id: tempBoardId, name: "Went Well", position: 0 },
          { id: `temp-col-2`, board_id: tempBoardId, name: "To Improve", position: 1 },
          { id: `temp-col-3`, board_id: tempBoardId, name: "Action Items", position: 2 },
        ];
    setBoards([newBoard, ...boards]);
    setActiveBoard(newBoard);
    setColumns(defaultColumns);
    setCards([]);
    setNewBoardName("");
    setIsModalOpen(false);
    setIsCreatingBoardInline(false);

    // Attempt to sync to DB in background, then refresh with real IDs
    try {
      const postRes = await axios.post(`${API_URL}/boards`, { name: newBoardName, template }, authHeaders(token));
      const realBoard = postRes.data;
      // Replace the temp board with the real one
      setBoards((prev) => prev.map((b) => b.id === tempBoardId ? { ...b, id: realBoard.id } : b));
      setActiveBoard((prev) => prev && prev.id === tempBoardId ? { ...prev, id: realBoard.id } : prev);
      // Fetch the real columns/cards
      const res = await axios.get(`${API_URL}/boards/${realBoard.id}`, authHeaders(token));
      if (res.data.columns) {
        setColumns(res.data.columns);
        setCards(res.data.cards || []);
      }
    } catch (error) {
      console.error("Failed to create board on server, removing temp board", error);
      // Remove the temp board since it couldn't be saved to the server
      setBoards((prev) => prev.filter((b) => b.id !== tempBoardId));
      setActiveBoard((prev) => {
        if (prev && prev.id === tempBoardId) {
          // Switch back to the first available board, or null
          const remaining = boards.filter((b) => b.id !== tempBoardId);
          return remaining.length > 0 ? remaining[0] : null;
        }
        return prev;
      });
      setColumns([]);
      setCards([]);
    }
  };

  const fetchBoardData = async (boardId) => {
    // Skip API fetch for temp boards (not yet saved to server)
    if (String(boardId).startsWith('temp-board-')) return;

    // Always start fresh, then load from cache or API
    if (boardCache[boardId]) {
      setColumns(boardCache[boardId].columns);
      setCards(boardCache[boardId].cards);
    } else {
      setColumns([]);
      setCards([]);
    }

    try {
      const res = await axios.get(`${API_URL}/boards/${boardId}`, authHeaders(token));
      // Always prefer fresh API data when available
      if (res.data.columns) {
        setColumns(res.data.columns);
        setCards(res.data.cards || []);
      }
      setIsEditingBoard(false);
    } catch (error) {
      console.error("Error fetching board data (using local cache)", error);
      setIsEditingBoard(false);
    }
  };

  const updateBoardName = async () => {
    if (!editBoardName.trim() || !activeBoard) return;
    try {
      await axios.put(`${API_URL}/boards/${activeBoard.id}`, { name: editBoardName }, authHeaders(token));
      const updatedBoards = boards.map((b) =>
        b.id === activeBoard.id ? { ...b, name: editBoardName } : b,
      );
      setBoards(updatedBoards);
      setActiveBoard({ ...activeBoard, name: editBoardName });
      setIsEditingBoard(false);
    } catch (error) {
      console.error("Error updating board", error);
      // Fallback update for offline mode
      const updatedBoards = boards.map((b) =>
        b.id === activeBoard.id ? { ...b, name: editBoardName } : b,
      );
      setBoards(updatedBoards);
      setActiveBoard({ ...activeBoard, name: editBoardName });
      setIsEditingBoard(false);
    }
  };

  const applyBoardBgUrl = async (url) => {
    if (!activeBoard) return;
    try {
      await axios.put(`${API_URL}/boards/${activeBoard.id}/bg`, { bg_image: url || null }, authHeaders(token));
      const updated = { ...activeBoard, bg_image: url || null };
      setActiveBoard(updated);
      setBoards(prev => prev.map(b => b.id === activeBoard.id ? { ...b, bg_image: url || null } : b));
    } catch (e) { console.error("Error updating board bg", e); }
  };

  const applyBoardBgFile = async (file) => {
    if (!activeBoard || !file) return;
    const formData = new FormData();
    formData.append('bg', file);
    try {
      const res = await axios.post(`${API_URL}/boards/${activeBoard.id}/bg-upload`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const url = `${API_URL.replace('/api', '')}${res.data.url}`;
      const updated = { ...activeBoard, bg_image: url };
      setActiveBoard(updated);
      setBoards(prev => prev.map(b => b.id === activeBoard.id ? { ...b, bg_image: url } : b));
    } catch (e) { console.error("Error uploading board bg", e); }
  };

  const deleteBoard = async (boardId, e) => {
    e.stopPropagation();
    if (!isAdmin && !isSuperUser) { alert("Only admins can delete boards."); return; }
    showConfirm("Delete this board? This cannot be undone.", async () => {
      try {
        await axios.delete(`${API_URL}/boards/${boardId}`, authHeaders(token));
        handleDeletedBoardState(boardId);
      } catch (error) {
        console.error("Error deleting board", error);
        handleDeletedBoardState(boardId);
      }
    });
  };

  const handleDeletedBoardState = (boardId) => {
    const remainingBoards = boards.filter((b) => b.id !== boardId);
    setBoards(remainingBoards);
    if (activeBoard?.id === boardId) {
      setActiveBoard(remainingBoards.length > 0 ? remainingBoards[0] : null);
    }
    if (remainingBoards.length === 0) {
      setIsModalOpen(true);
    }
  };

  const addColumn = async () => {
    if (!newColName || !activeBoard) return;

    const position = columns.length;
    const tempId = `temp-col-${Date.now()}`;
    const colName = newColName; // Save reference before clearing state

    const tempCol = {
      id: tempId,
      board_id: activeBoard.id,
      name: colName,
      position,
    };

    // Optimistically update the UI so it shows instantly
    userAddedColumn.current = true;
    setColumns((prev) => [...prev, tempCol]);
    setNewColName("");
    setIsAddingColumn(false);

    try {
      const res = await axios.post(`${API_URL}/columns`, {
        board_id: activeBoard.id,
        name: colName,
        position,
      }, authHeaders(token));
      // Replace the temporary column with the real one containing the DB's ID
      setColumns((prev) => prev.map((c) => (c.id === tempId ? res.data : c)));
    } catch (error) {
      console.error(
        "Error adding column to DB, keeping temporary column locally",
        error,
      );
    }
  };

  const updateColumnName = async () => {
    if (!editColumnName.trim() || !editingColumnId) {
      setEditingColumnId(null);
      return;
    }

    // Optimistic update
    setColumns((prev) =>
      prev.map((c) =>
        c.id === editingColumnId ? { ...c, name: editColumnName } : c,
      ),
    );
    const colId = editingColumnId;
    const newName = editColumnName;
    setEditingColumnId(null);

    try {
      if (!String(colId).startsWith("temp-")) {
        await axios.put(`${API_URL}/columns/${colId}`, { name: newName }, authHeaders(token));
      }
    } catch (error) {
      console.error("Error updating column name", error);
    }
  };

  const deleteColumn = async (colId) => {
    const col = columns.find((c) => c.id === colId);
    const colName = col ? col.name : 'this column';
    const colCards = cards.filter((c) => c.column_id === colId);
    const cardCount = colCards.length;
    const msg = cardCount > 0
      ? `Delete "${colName}" and its ${cardCount} card${cardCount > 1 ? 's' : ''}? This cannot be undone.`
      : `Delete "${colName}"? This cannot be undone.`;
    showConfirm(msg, async () => {
      // Track this column as pending-delete so WebSocket won't restore it
      pendingColumnDeletes.current.add(colId);

      // Optimistic update
      setColumns((prev) => prev.filter((c) => c.id !== colId));
      setCards((prev) => prev.filter((c) => c.column_id !== colId));

      try {
        if (!String(colId).startsWith("temp-")) {
          await axios.delete(`${API_URL}/columns/${colId}`, authHeaders(token));
        }
      } catch (error) {
        console.error("Error deleting column", error);
      }
    });
  };

  const addCard = async (columnId, content, imageUrl) => {
    const tempId = `temp-card-${Date.now()}`;

    const tempCard = {
      id: tempId,
      column_id: columnId,
      content,
      position: 0, // will be set properly by functional updater
      image_url: imageUrl || null,
    };

    // Optimistically update the UI — use functional updater to avoid stale state
    setCards((prev) => {
      const colCards = prev.filter((c) => c.column_id === columnId);
      return [...prev, { ...tempCard, position: colCards.length }];
    });

    try {
      const res = await axios.post(`${API_URL}/cards`, {
        column_id: columnId,
        content,
        position: 0, // server will use this; position corrected by broadcast
        image_url: imageUrl || null,
      }, authHeaders(token));
      // Replace the temp card and deduplicate — the real card may already
      // exist from a socket board:update that arrived before this response.
      setCards((prev) => {
        const cleaned = prev.filter((c) => c.id !== tempId && c.id !== res.data.id);
        return [...cleaned, res.data];
      });
    } catch (error) {
      console.error(
        "Error adding card to DB, keeping temporary card locally",
        error,
      );
    }
  };

  const updateCardContent = async () => {
    if (!editCardContent.trim() || !editingCardId) {
      setEditingCardId(null);
      setEditCardContent("");
      return;
    }

    // Optimistic update
    setCards((prev) =>
      prev.map((c) =>
        c.id === editingCardId ? { ...c, content: editCardContent } : c,
      ),
    );
    const cId = editingCardId;
    const newContent = editCardContent;
    setEditingCardId(null);

    try {
      if (!String(cId).startsWith("temp-")) {
        await axios.put(`${API_URL}/cards/${cId}`, { content: newContent }, authHeaders(token));
      }
    } catch (error) {
      console.error("Error updating card content", error);
    }
  };

  // Save editing card when clicking anywhere outside it
  const editingCardRef = useRef(null);
  const editingCardIdRef = useRef(null);
  editingCardIdRef.current = editingCardId;
  editCardContentRef.current = editCardContent;
  const addingCardRef = useRef(null);
  addingCardRef.current = addingCardToColId;
  newCardContentRef.current = newCardContent;
  newCardImageUrlRef.current = newCardImageUrl;
  isCreatingBoardInlineRef.current = isCreatingBoardInline;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    const handleGlobalMouseDown = (e) => {
      // Close inline board creation if clicking outside and text field is empty
      if (isCreatingBoardInlineRef.current && inlineBoardFormRef.current && !inlineBoardFormRef.current.contains(e.target)) {
        if (!newBoardNameRef.current.trim()) {
          setIsCreatingBoardInline(false);
          setNewBoardName("");
        }
      }
      // Save add-card if clicking outside it and there's content
      if (addingCardRef.current && addCardFormRef.current && !addCardFormRef.current.contains(e.target)) {
        // Don't close if clicking on an overlay (GIF picker, etc.)
        if (e.target.closest('.confirm-overlay') || e.target.closest('.gif-picker-modal') || e.target.closest('.gif-library-modal')) return;
        // Don't close if GIF picker just closed (avoids race with overlay removal)
        if (gifJustClosedRef.current) return;
        const colId = addingCardRef.current;
        const content = newCardContentRef.current;
        const imageUrl = newCardImageUrlRef.current;
        if (content.trim() || imageUrl) {
          addCard(colId, content.trim() || "", imageUrl || undefined);
        }
        setAddingCardToColId(null);
        setNewCardContent("");
        setNewCardImageUrl("");
      }
      // Save editing card if clicking outside it
      if (editingCardIdRef.current) {
        // Don't exit edit mode if clicking on an overlay (GIF picker, etc.)
        if (e.target.closest('.confirm-overlay') || e.target.closest('.gif-picker-modal') || e.target.closest('.gif-library-modal')) return;
        if (editingCardRef.current && editingCardRef.current.contains(e.target)) return;
        // Read current values from refs to avoid stale closure
        const cId = editingCardIdRef.current;
        const content = editCardContentRef.current;
        setEditingCardId(null);
        setEditCardContent("");
        if (content && content.trim() && cId) {
          setCards((prev) => prev.map((c) => c.id === cId ? { ...c, content } : c));
          if (!String(cId).startsWith("temp-")) {
            axios.put(`${API_URL}/cards/${cId}`, { content }, authHeaders(tokenRef.current)).catch(err => console.error("Error updating card content", err));
          }
        }
      }
    };
    document.addEventListener('mousedown', handleGlobalMouseDown);
    return () => document.removeEventListener('mousedown', handleGlobalMouseDown);
  }, []);

  const canDeleteCard = (card) => {
    if (isAdmin || isSuperUser) return true;
    return card.created_by_user_id === user?.id;
  };

  const toggleReaction = async (cardId, emoji) => {
    if (!cardId || !emoji) return;
    // Optimistic update
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c;
      const reactions = c.reactions || [];
      const existing = reactions.find(r => r.user_id === user?.id && r.emoji === emoji);
      if (existing) {
        return { ...c, reactions: reactions.filter(r => !(r.user_id === user?.id && r.emoji === emoji)) };
      } else {
        return { ...c, reactions: [...reactions, { user_id: user?.id, emoji, display_name: user?.display_name }] };
      }
    }));
    setReactionPickerCardId(null);
    setReactionPickerPos(null);
    try {
      await axios.post(`${API_URL}/cards/${cardId}/reactions`, { emoji }, authHeaders(token));
    } catch (err) { console.error('Failed to toggle reaction', err); }
  };

  const deleteCard = async (cardId) => {
    const card = cards.find((c) => c.id === cardId);
    if (card && !canDeleteCard(card)) return;
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    try {
      if (!String(cardId).startsWith("temp-")) {
        await axios.delete(`${API_URL}/cards/${cardId}`, authHeaders(token));
      }
    } catch (error) {
      console.error("Error deleting card", error);
    }
  };

  const archiveCard = (cardId) => {
    const card = cards.find((c) => c.id === cardId);
    if (card) {
      setArchivedCards((prev) => [...prev, { ...card, archivedAt: new Date().toISOString() }]);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    }
  };

  const archiveColumn = (colId) => {
    const col = columns.find((c) => c.id === colId);
    if (col) {
      const colCards = cards.filter((c) => c.column_id === colId);
      setArchivedColumns((prev) => [...prev, { ...col, cards: colCards, archivedAt: new Date().toISOString() }]);
      setColumns((prev) => prev.filter((c) => c.id !== colId));
      setCards((prev) => prev.filter((c) => c.column_id !== colId));
    }
  };

  const deleteAllCardsInColumn = (colId) => {
    if (!isAdmin && !isSuperUser) { alert("Only admins can clear a column."); return; }
    const colCards = cards.filter((c) => c.column_id === colId);
    setCards((prev) => prev.filter((c) => c.column_id !== colId));
    colCards.forEach(async (card) => {
      try {
        if (!String(card.id).startsWith("temp-")) {
          await axios.delete(`${API_URL}/cards/${card.id}`, authHeaders(token));
        }
      } catch (error) {
        console.error("Error deleting card", error);
      }
    });
  };

  const handleContextMenu = (e, type, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id });
  };

  const onBoardDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;
    const newBoards = Array.from(boards);
    const [removed] = newBoards.splice(source.index, 1);
    newBoards.splice(destination.index, 0, removed);
    setBoards(newBoards);
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId, type } = result;

    if (!destination) {
      isDraggingRef.current = false;
      flushPendingBoardUpdate();
      return;
    }

    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      isDraggingRef.current = false;
      flushPendingBoardUpdate();
      return;
    }

    if (type === "COLUMN") {
      if (!isAdmin && !isSuperUser) {
        isDraggingRef.current = false;
        flushPendingBoardUpdate();
        return;
      }
      let reorderedColumns;
      setColumns((prev) => {
        const newColumns = Array.from(prev);
        const [removedColumn] = newColumns.splice(source.index, 1);
        newColumns.splice(destination.index, 0, removedColumn);
        newColumns.forEach((col, index) => { col.position = index; });
        reorderedColumns = newColumns;
        return newColumns;
      });
      isDraggingRef.current = false;
      flushPendingBoardUpdate();
      // Persist the new column order to the database
      try {
        const payload = (reorderedColumns || []).map((col) => ({ id: col.id, position: col.position }));
        await axios.patch(`${API_URL}/columns/reorder`, { columns: payload }, authHeaders(token));
      } catch (error) {
        console.error('Failed to save column order:', error);
      }
      return;
    }

    // Treat IDs strictly as strings to prevent offline `temp-` bugs
    const cardId = String(draggableId).replace(/^card-/, '');
    const destColId = String(destination.droppableId);

    // Optimistically update UI
    let newCards = Array.from(cards);
    const draggedCardIndex = newCards.findIndex((c) => String(c.id) === cardId);

    if (draggedCardIndex === -1) return; // fail safe
    const draggedCard = newCards[draggedCardIndex];

    // Remove from old array
    newCards.splice(draggedCardIndex, 1);

    // Update the local column property for the card. (Respect offline temp strings)
    draggedCard.column_id = destColId.startsWith("temp-")
      ? destColId
      : parseInt(destColId);

    // Filter to find where to inject based on column UI state strictly checking as strings
    const destColCards = newCards
      .filter((c) => String(c.column_id) === destColId)
      .sort((a, b) => a.position - b.position);

    // Quick UI patch for the re-render (so it doesn't snap back)
    destColCards.splice(destination.index, 0, draggedCard);

    // Fix positioning for all cards in the destination column
    destColCards.forEach((card, index) => {
      card.position = index;
    });

    // Update global state
    const updatedCardsState = newCards
      .filter((c) => String(c.column_id) !== destColId)
      .concat(destColCards);
    setCards(updatedCardsState);

    // Call API just for the dragged card
    if (!cardId.startsWith("temp-") && !destColId.startsWith("temp-")) {
      try {
        await axios.put(`${API_URL}/cards/${cardId}`, {
          column_id: parseInt(destColId),
          position: destination.index,
        }, authHeaders(token));
      } catch (error) {
        console.error("Error moving card:", error);
      } finally {
        isDraggingRef.current = false;
        flushPendingBoardUpdate();
      }
    } else {
      isDraggingRef.current = false;
      flushPendingBoardUpdate();
    }
  };

    return (
      <ErrorBoundary>
        <div className="app-container">

          {/* Confirm Dialog */}
          {confirmDialog && (
            <div className="confirm-overlay" onClick={() => setConfirmDialog(null)}>
              <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
                <p className="confirm-message">{confirmDialog.message}</p>
                <div className="confirm-actions">
                  <button className="confirm-yes" onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>Yes</button>
                  <button className="confirm-cancel" onClick={() => setConfirmDialog(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {invitePrompt && (
            <div className="confirm-overlay" onClick={() => { if (!inviteActionLoading) setInvitePrompt(null); }}>
              <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
                <p className="confirm-message">
                  Invite to join board: <strong>{invitePrompt.boardName || 'Retro Board'}</strong>
                </p>
                <div className="confirm-actions">
                  <button className="confirm-yes" disabled={inviteActionLoading || invitePrompt.status !== 'PENDING'} onClick={() => respondToInvite('accept')}>Accept</button>
                  <button className="confirm-cancel" disabled={inviteActionLoading || invitePrompt.status !== 'PENDING'} onClick={() => respondToInvite('decline')}>Decline</button>
                </div>
                {invitePrompt.status !== 'PENDING' && (
                  <p style={{ marginTop: 10, fontSize: '0.85rem', color: '#777' }}>
                    This invite is already {String(invitePrompt.status).toLowerCase()}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Background Picker Modal */}
          {showBgPicker && (
            <div className="confirm-overlay" onClick={() => setShowBgPicker(false)}>
              <div className="bg-picker-modal" onClick={e => e.stopPropagation()}>
                <div className="bg-picker-header">
                  <span>Change Background</span>
                  <button className="settings-close" onClick={() => setShowBgPicker(false)}><X size={16} /></button>
                </div>
                <div className="bg-picker-body">
                  <p className="bg-picker-label">Paste an image URL</p>
                  <div className="bg-picker-url-row">
                    <input
                      className="bg-picker-input"
                      placeholder="https://example.com/image.jpg"
                      value={bgPickerUrl}
                      onChange={e => setBgPickerUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { applyBoardBgUrl(bgPickerUrl); setShowBgPicker(false); } }}
                    />
                    <button className="bg-picker-apply-btn" onClick={() => { applyBoardBgUrl(bgPickerUrl); setShowBgPicker(false); }}>Apply</button>
                  </div>
                  <div className="bg-picker-divider">or</div>
                  <input
                    ref={bgFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (file) { await applyBoardBgFile(file); setShowBgPicker(false); }
                      e.target.value = '';
                    }}
                  />
                  <button className="bg-picker-file-btn" onClick={() => bgFileInputRef.current?.click()}>
                    <Image size={15} style={{ marginRight: 7 }} /> Choose from files
                  </button>
                  {activeBoard?.bg_image && (
                    <button className="bg-picker-remove-btn" onClick={() => { applyBoardBgUrl(null); setShowBgPicker(false); }}>
                      Remove background
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Board Members Panel */}
          {showMembersPanel && (
            <div className="confirm-overlay" onClick={() => setShowMembersPanel(false)}>
              <div className="members-modal" onClick={e => e.stopPropagation()}>
                <div className="members-header">
                  <span>Board Members</span>
                  <button className="settings-close" onClick={() => setShowMembersPanel(false)}><X size={16} /></button>
                </div>
                <div className="members-body">
                  <div className="members-add-section">
                    <div className="members-invite-url-block">
                      <p className="members-label">Board invite URL</p>
                      <div className="members-invite-url-row">
                        <input
                          className="members-search-input"
                          value={boardInviteUrlLoading ? 'Loading invite link...' : (boardInviteUrl || 'Invite link unavailable')}
                          readOnly
                        />
                        <button
                          className="members-add-btn"
                          type="button"
                          disabled={!boardInviteUrl || boardInviteUrlLoading}
                          onClick={async () => {
                            try {
                              if (navigator?.clipboard?.writeText && boardInviteUrl) {
                                await navigator.clipboard.writeText(boardInviteUrl);
                                setBoardInviteUrlCopied(true);
                                setTimeout(() => setBoardInviteUrlCopied(false), 2000);
                              }
                            } catch (e) {
                              console.error("Could not copy invite URL", e);
                            }
                          }}
                        >
                          Copy
                        </button>
                      </div>
                      {boardInviteUrlCopied && (
                        <p style={{ color: '#22c55e', fontSize: '0.75rem', marginTop: 4, marginBottom: 0 }}>Copied</p>
                      )}
                      <p className="members-empty" style={{ marginTop: 4 }}>
                        Link resets daily at 11:59 PM PDT.
                      </p>
                    </div>
                    <p className="members-label">Add a member</p>
                    <input
                      className="members-search-input"
                      placeholder="Search by name..."
                      value={memberSearchQuery}
                      onChange={e => setMemberSearchQuery(e.target.value)}
                    />
                    <ul className="members-search-results">
                      {deptUsersForBoard
                        .filter(u => {
                          // Exclude users already added as members
                          if (boardMembers.some(m => m.id === u.id)) return false;
                          // Filter by search query
                          if (!memberSearchQuery.trim()) return true;
                          return u.display_name.toLowerCase().includes(memberSearchQuery.toLowerCase());
                        })
                        .slice(0, 10)
                        .map(u => (
                          <li key={u.id} className="members-search-item">
                            <span>
                              {u.display_name}
                              {pendingInvites.some(p => Number(p.invitee_user_id) === Number(u.id)) && (
                                <span className="status-pill pending-pill">PENDING</span>
                              )}
                            </span>
                            <button
                              className="members-add-btn"
                              title={`Add ${u.display_name}`}
                              disabled={pendingInvites.some(p => Number(p.invitee_user_id) === Number(u.id))}
                              onClick={() => addBoardMember(activeBoard.id, u.id)}
                            >
                              <UserPlus size={14} />
                            </button>
                          </li>
                        ))
                      }
                      {deptUsersForBoard.filter(u => !boardMembers.some(m => m.id === u.id) && (!memberSearchQuery.trim() || u.display_name.toLowerCase().includes(memberSearchQuery.toLowerCase()))).length === 0 && (
                        <li className="members-search-empty">No users to add</li>
                      )}
                    </ul>
                  </div>
                  <div className="members-divider" />
                  <div className="members-current-section">
                    <p className="members-label">Pending invites ({pendingInvites.length})</p>
                    {pendingInvites.length === 0 ? (
                      <p className="members-empty">No pending invites</p>
                    ) : (
                      <ul className="members-list">
                        {pendingInvites.map(inv => (
                          <li key={inv.id} className="members-list-item">
                            <div className="members-list-info">
                              <span className="members-list-name">{inv.display_name || inv.invitee_email || 'Pending user'} <span className="status-pill pending-pill">PENDING</span></span>
                              <span className="members-list-email">{inv.invitee_email || ''}</span>
                            </div>
                            <button
                              className="members-remove-btn"
                              title="Cancel invite"
                              onClick={() => cancelPendingInvite(activeBoard.id, inv.id)}
                            >
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="members-divider" />
                  <div className="members-current-section">
                    <p className="members-label">Current members ({boardMembers.length})</p>
                    {boardMembers.length === 0 ? (
                      <p className="members-empty">No members added yet</p>
                    ) : (
                      <ul className="members-list">
                        {boardMembers.map(m => (
                          <li key={m.id} className="members-list-item">
                            <div className="members-list-info">
                              <span className="members-list-name">{m.display_name}</span>
                              <span className="members-list-email">{m.email}</span>
                            </div>
                            <button
                              className="members-remove-btn"
                              title={`Remove ${m.display_name}`}
                              onClick={() => removeBoardMember(activeBoard.id, m.id)}
                            >
                              <UserMinus size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* GIF Picker (for selecting a GIF to add to a card) */}
          {showGifPicker && (
            <div className="confirm-overlay" onClick={() => { setShowGifPicker(false); setGifPickerContext(null); }}>
              <div className="gif-picker-modal" onClick={e => e.stopPropagation()}>
                <div className="gif-picker-header">
                  <span>Choose a GIF</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="gif-manage-btn" title="Add your own GIFs" onClick={() => { setShowGifPicker(false); setGifPickerContext(null); openGifLibrary(); }}>
                      <Plus size={14} />
                    </button>
                    <button className="settings-close" onClick={() => { setShowGifPicker(false); setGifPickerContext(null); }}><X size={16} /></button>
                  </div>
                </div>
                <div className="gif-picker-search">
                  <Search size={14} />
                  <input
                    placeholder="Search GIFs..."
                    value={gifSearch}
                    onChange={(e) => {
                      setGifSearch(e.target.value);
                      clearTimeout(gifSearchTimeout.current);
                      gifSearchTimeout.current = setTimeout(() => { fetchGifs(e.target.value, 1, gifTab); }, 300);
                    }}
                  />
                </div>
                <div className="gif-picker-tabs">
                  <button className={`gif-tab${gifTab === 'all' ? ' gif-tab-active' : ''}`} onClick={() => { setGifTab('all'); setGifPage(1); fetchGifs(gifSearch, 1, 'all'); }}>All</button>
                  <button className={`gif-tab${gifTab === 'custom' ? ' gif-tab-active' : ''}`} onClick={() => { setGifTab('custom'); setGifPage(1); fetchGifs(gifSearch, 1, 'custom'); }}>Custom</button>
                  <button className={`gif-tab${gifTab === 'mine' ? ' gif-tab-active' : ''}`} onClick={() => { setGifTab('mine'); setGifPage(1); fetchGifs(gifSearch, 1, 'mine'); }}>My Uploads</button>
                </div>
                <div className="gif-picker-grid">
                  {gifLoading ? (
                    <div className="gif-picker-loading">Loading...</div>
                  ) : gifList.length === 0 ? (
                    <div className="gif-picker-empty">No GIFs found. Open the library to add some!</div>
                  ) : (
                    gifList.map(gif => (
                      <div key={gif.id} className="gif-picker-item" onClick={() => selectGif(gif)}>
                        <img src={gif.url?.startsWith('/') ? `${API_URL.replace('/api', '')}${gif.url}` : gif.url} alt={gif.title} loading="lazy" />
                        {isSuperUser && (gifTab === 'custom' || gifTab === 'mine') && !gif.is_default && (
                          <button
                            className="gif-picker-item-delete"
                            title="Delete GIF"
                            onClick={e => { e.stopPropagation(); deleteGif(gif.id); }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {gifTotal > 12 && (
                  <div className="gif-picker-pagination">
                    <button disabled={gifPage <= 1} onClick={() => { const p = gifPage - 1; setGifPage(p); fetchGifs(gifSearch, p, gifTab); }}>Prev</button>
                    <span>Page {gifPage} of {Math.ceil(gifTotal / 12)}</span>
                    <button disabled={gifPage >= Math.ceil(gifTotal / 12)} onClick={() => { const p = gifPage + 1; setGifPage(p); fetchGifs(gifSearch, p, gifTab); }}>Next</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GIF Library Management Modal */}
          {showGifLibrary && (
            <div className="confirm-overlay" onClick={() => setShowGifLibrary(false)}>
              <div className="gif-library-modal" onClick={e => e.stopPropagation()}>
                <div className="gif-library-header">
                  <span>GIF Library</span>
                  <button className="settings-close" onClick={() => setShowGifLibrary(false)}><X size={16} /></button>
                </div>
                <div className="gif-library-add-section">
                  <p className="gif-library-label">Add a GIF by URL</p>
                  <div className="gif-library-add-row">
                    <input
                      className="gif-library-url-input"
                      placeholder="Paste GIF URL..."
                      value={gifAddUrl}
                      onChange={e => setGifAddUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addGifByUrl(); }}
                    />
                    <input
                      className="gif-library-title-input"
                      placeholder="Name (required)"
                      value={gifAddTitle}
                      onChange={e => setGifAddTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addGifByUrl(); }}
                    />
                  </div>
                  <div className="gif-library-upload-row">
                    <button className="gif-library-add-btn" onClick={addGifByUrl} disabled={!gifAddUrl.trim() || !gifAddTitle.trim()}>Add</button>
                    <button className="gif-library-upload-btn" onClick={() => gifUploadRef.current?.click()}>
                      <Upload size={14} /> {gifUploadPending ? 'Change File' : 'Upload GIF File'}
                    </button>
                    <input
                      ref={gifUploadRef}
                      type="file"
                      accept="image/gif,image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setGifUploadPending(file);
                          if (!gifUploadTitle) setGifUploadTitle(file.name.replace(/\.[^.]+$/, ''));
                        }
                        e.target.value = '';
                      }}
                    />
                    <button className="gif-library-add-btn" style={{ background: '#666' }} onClick={() => { setGifAddUrl(''); setGifAddTitle(''); setGifUploadPending(null); setGifUploadTitle(''); }}>Cancel</button>
                  </div>
                  {gifUploadPending && (
                    <div className="gif-library-add-row" style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>File: {gifUploadPending.name}</span>
                      <input
                        className="gif-library-title-input"
                        placeholder="Name (required)"
                        value={gifUploadTitle}
                        onChange={e => setGifUploadTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') uploadGifFile(gifUploadPending, gifUploadTitle); }}
                      />
                      <button className="gif-library-add-btn" onClick={() => uploadGifFile(gifUploadPending, gifUploadTitle)} disabled={!gifUploadTitle.trim()}>Upload</button>
                    </div>
                  )}
                </div>
                <div className="gif-library-divider" />
                <div className="gif-library-browse-section">
                  <div className="gif-library-browse-header">
                    <p className="gif-library-label">Library ({gifTotal} GIFs)</p>
                    <div className="gif-picker-search" style={{ flex: 1, maxWidth: 280 }}>
                      <Search size={14} />
                      <input
                        placeholder="Search..."
                        value={gifSearch}
                        onChange={(e) => {
                          setGifSearch(e.target.value);
                          clearTimeout(gifSearchTimeout.current);
                          gifSearchTimeout.current = setTimeout(() => { fetchGifs(e.target.value, 1, gifTab); }, 300);
                        }}
                      />
                    </div>
                  </div>
                  <div className="gif-library-grid">
                    {gifLoading ? (
                      <div className="gif-picker-loading">Loading...</div>
                    ) : gifList.length === 0 ? (
                      <div className="gif-picker-empty">No GIFs in the library yet.</div>
                    ) : (
                      gifList.map(gif => (
                        <div key={gif.id} className="gif-library-item">
                          <img src={gif.url?.startsWith('/') ? `${API_URL.replace('/api', '')}${gif.url}` : gif.url} alt={gif.title} loading="lazy" />
                          <div className="gif-library-item-overlay">
                            <span className="gif-library-item-title">{gif.title || 'Untitled'}</span>
                            {(isAdmin || isSuperUser || gif.added_by === user?.id) && (
                              <button className="gif-library-item-delete" title="Remove from library" onClick={() => deleteGif(gif.id)}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {gifTotal > 12 && (
                    <div className="gif-picker-pagination">
                      <button disabled={gifPage <= 1} onClick={() => { const p = gifPage - 1; setGifPage(p); fetchGifs(gifSearch, p, gifTab); }}>Prev</button>
                      <span>Page {gifPage} of {Math.ceil(gifTotal / 12)}</span>
                      <button disabled={gifPage >= Math.ceil(gifTotal / 12)} onClick={() => { const p = gifPage + 1; setGifPage(p); fetchGifs(gifSearch, p, gifTab); }}>Next</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Settings Modal */}
          {showSettings && (
            <div className="settings-overlay" onClick={() => setShowSettings(false)}>
              <div className="settings-modal" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                  <h2>Settings</h2>
                  <button className="settings-close" onClick={() => setShowSettings(false)}><X size={18} /></button>
                </div>

                {settingsMsg && (
                  <div className={`settings-msg settings-msg-${settingsMsg.type}`}>{settingsMsg.text}</div>
                )}

                {/* Profile Info */}
                <section className="settings-section">
                  <h3 className="settings-section-title">Profile</h3>
                  <div className="settings-info-row">
                    <span className="settings-info-label">First Name</span>
                    <span className="settings-info-value">{user?.first_name || '—'}</span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Last Name</span>
                    <span className="settings-info-value">{user?.last_name || '—'}</span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Email</span>
                    <span className="settings-info-value">{user?.email}</span>
                  </div>
                  {!isSuperUser && (
                    <>
                      <div className="settings-info-row">
                        <span className="settings-info-label">Department</span>
                        <span className="settings-info-value">{user?.department || '—'}</span>
                      </div>
                      <div className="settings-info-row">
                        <span className="settings-info-label">Lead</span>
                        <span className="settings-info-value">{user?.lead || '—'}</span>
                      </div>
                    </>
                  )}
                  <div className="settings-info-row">
                    <span className="settings-info-label">Role</span>
                    <span className="settings-info-value">
                      {isOverlord ? <span className="user-badge-master">OVERLORD</span>
                        : isSuperUser ? <span className="user-badge-master">{roleLabels.master}</span>
                        : isAdmin ? <span className="user-badge-dept">{roleLabels.admin}</span>
                        : roleLabels.user}
                    </span>
                  </div>
                </section>

                {/* Name */}
                <section className="settings-section">
                  <div className="settings-section-header-row">
                    <h3 className="settings-section-title">Name</h3>
                    <button
                      className="settings-edit-btn"
                      title={settingsEditingName ? "Cancel" : "Edit name"}
                      onClick={() => {
                        if (settingsEditingName) {
                          setSettingsEditingName(false);
                          setSettingsMsg(null);
                        } else {
                          setSettingsFirstName(user?.first_name || "");
                          setSettingsLastName(user?.last_name || "");
                          setSettingsEditingName(true);
                          setSettingsMsg(null);
                        }
                      }}
                    >
                      {settingsEditingName ? <X size={14} /> : <Edit2 size={14} />}
                    </button>
                  </div>
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <label>First Name</label>
                      <input
                        type="text"
                        value={settingsEditingName ? settingsFirstName : (user?.first_name || "")}
                        onChange={e => { setSettingsFirstName(e.target.value); setSettingsMsg(null); }}
                        placeholder="First"
                        disabled={!settingsEditingName}
                        autoComplete="off"
                      />
                    </div>
                    <div className="settings-field">
                      <label>Last Name</label>
                      <input
                        type="text"
                        value={settingsEditingName ? settingsLastName : (user?.last_name || "")}
                        onChange={e => { setSettingsLastName(e.target.value); setSettingsMsg(null); }}
                        placeholder="Last"
                        disabled={!settingsEditingName}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {settingsEditingName && (
                    <button
                      className="settings-save-btn"
                      onClick={saveProfile}
                      disabled={!settingsFirstName.trim() || !settingsLastName.trim()}
                    >
                      Save Name
                    </button>
                  )}
                </section>

                {/* Password */}
                <section className="settings-section">
                  <div className="settings-section-header-row">
                    <h3 className="settings-section-title">Password</h3>
                    <button
                      className="settings-edit-btn"
                      title={settingsEditingPw ? "Cancel" : "Change password"}
                      onClick={() => {
                        if (settingsEditingPw) {
                          setSettingsEditingPw(false);
                          setSettingsCurPw(""); setSettingsNewPw(""); setSettingsConfirmPw("");
                          setSettingsMsg(null);
                        } else {
                          setSettingsCurPw(""); setSettingsNewPw(""); setSettingsConfirmPw("");
                          setSettingsEditingPw(true);
                          setSettingsMsg(null);
                        }
                      }}
                    >
                      {settingsEditingPw ? <X size={14} /> : <Edit2 size={14} />}
                    </button>
                  </div>
                  {settingsEditingPw && (
                    <>
                      <div className="settings-field">
                        <label>Current Password</label>
                        <div className="settings-pw-wrapper">
                          <input
                            type={settingsShowCurPw ? "text" : "password"}
                            value={settingsCurPw}
                            onChange={e => { setSettingsCurPw(e.target.value); setSettingsMsg(null); }}
                            placeholder="Current password"
                            autoComplete="current-password"
                          />
                          <button type="button" className="settings-pw-toggle" onClick={() => setSettingsShowCurPw(v => !v)}>
                            {settingsShowCurPw ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                      <div className="settings-field">
                        <label>New Password</label>
                        <div className="settings-pw-wrapper">
                          <input
                            type={settingsShowNewPw ? "text" : "password"}
                            value={settingsNewPw}
                            onChange={e => { setSettingsNewPw(e.target.value); setSettingsMsg(null); }}
                            placeholder="At least 6 characters"
                            autoComplete="new-password"
                          />
                          <button type="button" className="settings-pw-toggle" onClick={() => setSettingsShowNewPw(v => !v)}>
                            {settingsShowNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                      <div className="settings-field">
                        <label>Confirm New Password</label>
                        <input
                          type="password"
                          value={settingsConfirmPw}
                          onChange={e => { setSettingsConfirmPw(e.target.value); setSettingsMsg(null); }}
                          placeholder="Re-enter new password"
                          autoComplete="new-password"
                        />
                      </div>
                      <button
                        className="settings-save-btn"
                        onClick={savePassword}
                        disabled={!settingsCurPw || !settingsNewPw || !settingsConfirmPw}
                      >
                        Change Password
                      </button>
                    </>
                  )}
                </section>

                {/* Delete Account */}
                <section className="settings-section settings-danger-section">
                  <div className="settings-section-header-row">
                    <h3 className="settings-section-title settings-danger-title">Delete Account</h3>
                  </div>
                  <p className="settings-danger-text">Permanently deletes your account. This cannot be undone.</p>
                  <button
                    className="settings-delete-btn"
                    onClick={() => showConfirm("Are you sure you want to permanently delete your account? This cannot be undone.", deleteOwnAccount)}
                  >
                    Delete My Account
                  </button>
                </section>
              </div>
            </div>
          )}

          {/* Create Board Modal */}
          {isModalOpen && (
            <div className="modal-overlay">
              <div className="modal-content">
                <div className="modal-header">
                  <h2>Create a New Board</h2>
                  {boards.length > 0 && (
                    <button
                      className="close-modal"
                      onClick={() => setIsModalOpen(false)}
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
                <div className="modal-body">
                  <input
                    type="text"
                    autoFocus
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    placeholder="Enter board name..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBoardName.trim()) createBoard('blank');
                    }}
                  />
                  <div className="board-template-options">
                    <button
                      className="board-template-btn"
                      onClick={() => createBoard('blank')}
                      disabled={!newBoardName.trim() || boards.length >= maxBoards}
                    >
                      <Plus size={18} />
                      <span>Blank</span>
                      <small>3 default columns</small>
                    </button>
                    <button
                      className="board-template-btn"
                      onClick={() => createBoard('template')}
                      disabled={!newBoardName.trim() || boards.length >= maxBoards}
                    >
                      <Archive size={18} />
                      <span>Use Template</span>
                      <small>5 retro columns</small>
                    </button>
                  </div>
                  {boards.length >= maxBoards && (
                    <p className="limit-warning">
                      Maximum of {maxBoards} boards reached.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className={`sidebar${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
            style={!sidebarCollapsed ? { width: sidebarWidth } : undefined}
            {...(sidebarCollapsed ? {
              onClick: () => { setSidebarCollapsed(false); localStorage.setItem("retro_sidebar_collapsed", "false"); },
              title: "Expand sidebar",
              role: "button",
              tabIndex: 0,
            } : {})}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={20} className="sidebar-expand-icon" />
            ) : (
            <>
            <div className="sidebar-content">
            <div className="sidebar-header">
              <h2>{sidebarPanel === "users" ? "Users" : "Vault Jump Retro"}</h2>
              <div className="sidebar-actions">
                <div className="font-size-wrapper">
                  <button
                    className="theme-toggle-btn"
                    onClick={(e) => { e.stopPropagation(); setShowFontSlider(!showFontSlider); }}
                    title="Adjust font size"
                  >
                    <span style={{ fontWeight: 700, fontSize: 12 }}>A</span>
                  </button>
                  {showFontSlider && (
                    <div className="font-slider-popup" onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="range"
                        min={100}
                        max={150}
                        step={5}
                        value={sidebarFontSize}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setSidebarFontSize(val);
                          localStorage.setItem('retro_sidebar_fontsize', String(val));
                        }}
                      />
                      <span className="font-slider-label">{sidebarFontSize}%</span>
                    </div>
                  )}
                </div>
                <button
                  className="theme-toggle-btn"
                  onClick={() => setIsDarkTheme(!isDarkTheme)}
                  title="Toggle Dark Theme"
                >
                  {isDarkTheme ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                {sidebarPanel === "boards" && (isAdmin || isSuperUser) && (
                  <button
                    className="add-board-btn"
                    onClick={() => {
                      if (boards.length === 0) setIsModalOpen(true);
                      else setIsCreatingBoardInline(!isCreatingBoardInline);
                    }}
                    disabled={boards.length >= maxBoards}
                    title={boards.length >= maxBoards ? `Limit of ${maxBoards} boards reached` : "Create new board"}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="sidebar-scrollable" style={{ fontSize: `${sidebarFontSize}%` }}>
            {isSuperUser && (sidebarPanel === "boards" || sidebarPanel === "users" || sidebarPanel === "labels") && (
              <div className="sidebar-company-filter-row">
                <span className="sidebar-company-filter-label">Company</span>
                <select
                  className="sidebar-company-filter-select"
                  value={effectiveCompanyFilter}
                  onChange={(e) => setMasterCompanyFilter(e.target.value)}
                >
                  {[...new Set([user?.company || DEFAULT_COMPANY, ...companyFilterOptions])].map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Boards panel */}
            {sidebarPanel === "boards" && (
              <>
                <div className="board-count">{boards.length}/{maxBoards} Boards</div>
                <div className="users-section">
                  <div className="users-section-header">Active Boards</div>
                  <DragDropContext onDragEnd={onBoardDragEnd}>
                    <Droppable droppableId="board-list" type="BOARD">
                      {(provided) => (
                        <ul className="board-list" ref={provided.innerRef} {...provided.droppableProps}>
                          {isCreatingBoardInline && (
                            <li className="creating-board-item" ref={inlineBoardFormRef}>
                              <input
                                autoFocus
                                className="inline-board-input"
                                value={newBoardName}
                                onChange={(e) => setNewBoardName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") createBoard('blank');
                                  if (e.key === "Escape") { setIsCreatingBoardInline(false); setNewBoardName(""); }
                                }}
                                placeholder="Board name..."
                              />
                              <div className="inline-board-btns">
                                <button onClick={() => createBoard('blank')} disabled={!newBoardName.trim()} className="inline-create-btn" title="Blank board (3 columns)">
                                  Blank
                                </button>
                                <button onClick={() => createBoard('template')} disabled={!newBoardName.trim()} className="inline-create-btn inline-template-btn" title="Template board (5 columns)">
                                  Template
                                </button>
                              </div>
                            </li>
                          )}
                          {boards.map((b, index) => (
                            <Draggable key={String(b.id)} draggableId={`board-${b.id}`} index={index}>
                              {(provided) => (
                                <li
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={activeBoard?.id === b.id ? "active" : ""}
                                  onClick={() => handleBoardClick(b)}
                                  onContextMenu={(e) => handleContextMenu(e, "board", b.id)}
                                >
                                  {(isAdmin || isSuperUser) && (
                                    <button className="delete-board-btn" onClick={(e) => deleteBoard(b.id, e)} title="Delete Board">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                  <span className="board-link-text">{b.name}</span>
                                </li>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </ul>
                      )}
                    </Droppable>
                  </DragDropContext>
                </div>

                <div className="users-section">
                  <div className="users-section-header">Pending</div>
                  <ul className="users-list">
                    {myPendingBoardInvites.length === 0 && (
                      <li className="user-item">
                        <div className="user-row" style={{ cursor: 'default' }}>
                          <div className="user-row-name" style={{ color: '#8aa8d8' }}>No pending board invites</div>
                        </div>
                      </li>
                    )}
                    {myPendingBoardInvites.map(inv => (
                      <li key={`pending-invite-${inv.id}`} className="user-item">
                        <div className="user-row" onClick={() => setInvitePrompt({ ...inv, token: inv.token, status: 'PENDING' })}>
                          <div className="user-row-line1">
                            <span className="user-row-name">{inv.boardName || 'Board Invite'}</span>
                            <span className="status-pill pending-pill">PENDING</span>
                          </div>
                          <div className="user-row-email">Click to accept or decline</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {/* Users panel — masters only */}
            {sidebarPanel === "users" && (
              <div className="users-panel">
                {usersLoading ? (
                  <p className="users-loading">Loading users…</p>
                ) : (
                  <>
                  {/* Masters section */}
                  {(() => {
                    const masters = usersList.filter(u => u.is_master || u.is_overlord);
                    if (masters.length === 0) return null;
                    return (
                      <div className="users-section">
                        <div className="users-section-header">Masters</div>
                        <ul className="users-list">
                          {masters.map(u => (
                            <li key={u.id} className="user-item">
                              <div
                                className="user-row"
                                onContextMenu={isSuperUser ? (e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: "user", id: u.id, dept: u.department || "OWS" }); } : undefined}
                              >
                                <div className="user-row-line1">
                                  <span className="user-row-name">{u.display_name || u.username}</span>
                                  <span className="user-badge-master">{u.is_overlord ? 'OVERLORD' : roleLabels.master}</span>
                                </div>
                                {u.email && <div className="user-row-email" title={u.email}>{u.email}</div>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}

                  {/* Users section — grouped by Lead */}
                  {(() => {
                    const members = usersList.filter(u => !u.is_master && !u.is_overlord);
                    if (members.length === 0) return null;
                    // Build lead groups preserving order of first appearance
                    const leadOrder = [];
                    const leadGroups = {};
                    members.forEach(u => {
                      const key = u.lead || "Unassigned";
                      if (!leadGroups[key]) {
                        leadGroups[key] = [];
                        leadOrder.push(key);
                      }
                      leadGroups[key].push(u);
                    });
                    // Move "Unassigned" to the end if present
                    const idx = leadOrder.indexOf("Unassigned");
                    if (idx > -1) { leadOrder.splice(idx, 1); leadOrder.push("Unassigned"); }

                    const renderUserItem = (u) => (
                      <li key={u.id} className="user-item">
                        {isSuperUser && editingUserId === u.id ? (
                          <div className="user-edit-form">
                            <div className="user-edit-name-row">
                              <input
                                className="user-edit-input"
                                placeholder="First name"
                                value={editUserFirstName}
                                onChange={e => setEditUserFirstName(e.target.value)}
                              />
                              <input
                                className="user-edit-input"
                                placeholder="Last name"
                                value={editUserLastName}
                                onChange={e => setEditUserLastName(e.target.value)}
                              />
                            </div>
                            <select
                              className="user-edit-select"
                              value={editUserDept}
                              onChange={e => { setEditUserDept(e.target.value); setEditUserLead(""); }}
                            >
                              <option value="QA">QA</option>
                              <option value="SE">Software Engineers (SE)</option>
                              <option value="SDET">SDET</option>
                            </select>
                            <select
                              className="user-edit-select"
                              value={editUserLead}
                              onChange={e => setEditUserLead(e.target.value)}
                            >
                              <option value="">Select lead…</option>
                              {usersList
                                .filter(lu => lu.department === editUserDept)
                                .map(lu => (
                                  <option key={lu.id} value={lu.display_name}>{lu.display_name}</option>
                                ))
                              }
                            </select>
                            <div className="user-edit-actions">
                              <button className="user-save-btn" onClick={() => saveUserEdit(u.id)} disabled={!editUserLead}>Save</button>
                              <button className="user-cancel-btn" onClick={() => setEditingUserId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="user-row"
                            onClick={isSuperUser ? () => { if (!u.is_master && !u.is_overlord) { setEditingUserId(u.id); setEditUserDept(u.department || "QA"); setEditUserLead(u.lead || ""); setEditUserFirstName(u.first_name || ""); setEditUserLastName(u.last_name || ""); } } : undefined}
                            onContextMenu={isSuperUser ? (e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: "user", id: u.id, dept: u.department || "OWS" }); } : undefined}
                          >
                            <div className="user-row-line1">
                              <span className="user-row-name">{u.display_name || u.username}</span>
                              {!!u.is_admin && <span className="user-badge-dept">{u.department || ""}</span>}
                              {u.role_key && roleLabels[u.role_key] && <span className="user-badge-role">{roleLabels[u.role_key]}</span>}
                            </div>
                            {u.email && <div className="user-row-email" title={u.email}>{u.email}</div>}
                          </div>
                        )}
                      </li>
                    );

                    return (
                      <div className="users-section">
                        <div className="users-section-header">Users</div>
                        {leadOrder.map(leadName => (
                          <div key={leadName} className="users-lead-group">
                            <div className="users-lead-header">{leadName}</div>
                            <ul className="users-list">
                              {leadGroups[leadName].map(renderUserItem)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  </>
                )}
              </div>
            )}

            {/* Labels panel — masters only */}
            {sidebarPanel === "labels" && (
              <div className="labels-panel">
                <div className="labels-panel-title">Role Labels</div>
                {editingLabels ? (
                  <>
                    {Object.entries(editingLabels).map(([key, val]) => (
                      <div key={key} className="label-edit-row">
                        <span className="label-edit-key">{key}</span>
                        <input
                          className="label-edit-input"
                          value={val}
                          onChange={e => setEditingLabels(prev => ({ ...prev, [key]: e.target.value }))}
                        />
                        {!['master','admin','user'].includes(key) && (
                          <button className="label-delete-btn" onClick={() => { deleteRoleLabel(key); setEditingLabels(prev => { const n = { ...prev }; delete n[key]; return n; }); }} title="Remove">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="labels-panel-actions">
                      <button className="label-save-btn" onClick={saveRoleLabels}>Save</button>
                      <button className="label-cancel-btn" onClick={() => setEditingLabels(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    {Object.entries(roleLabels).map(([key, val]) => (
                      <div key={key} className="label-display-row">
                        <span className="label-display-key">{key}</span>
                        <span className="label-display-val">{val}</span>
                      </div>
                    ))}
                    <button className="label-edit-start-btn" onClick={() => setEditingLabels({ ...roleLabels })}>
                      <Edit2 size={13} style={{ marginRight: 5 }} /> Edit Labels
                    </button>
                  </>
                )}
                <div className="labels-panel-divider" />
                <div className="labels-panel-subtitle">Add New Tag</div>
                <div className="label-add-row">
                  <input className="label-add-input" placeholder="Key (e.g. lead)" value={newLabelKey} onChange={e => setNewLabelKey(e.target.value)} />
                  <input className="label-add-input" placeholder="Display name" value={newLabelVal} onChange={e => setNewLabelVal(e.target.value)} />
                  <button className="label-add-btn" onClick={addRoleLabel} disabled={!newLabelKey.trim() || !newLabelVal.trim()}>
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )}
            </div>{/* close sidebar-scrollable zoom wrapper */}

            {/* Bottom tab buttons — masters and admins */}
            {(isSuperUser || isAdmin) && (
              <div className="sidebar-tabs">
                <button
                  className={`sidebar-tab${sidebarPanel === "boards" ? " sidebar-tab-active" : ""}`}
                  onClick={() => setSidebarPanel("boards")}
                >
                  Boards
                </button>
                <button
                  className={`sidebar-tab${sidebarPanel === "users" ? " sidebar-tab-active" : ""}`}
                  onClick={() => { setSidebarPanel("users"); fetchUsers(); if (isSuperUser) { fetchAdminEmails(); fetchMasterEmails(); } }}
                >
                  <Users size={14} style={{ marginRight: 5 }} /> Users
                </button>
                {isSuperUser && (
                  <button
                    className={`sidebar-tab${sidebarPanel === "labels" ? " sidebar-tab-active" : ""}`}
                    onClick={() => setSidebarPanel("labels")}
                  >
                    Tags
                  </button>
                )}
              </div>
            )}
            </div>
            <div
              className="sidebar-collapse-strip"
              onClick={() => { setSidebarCollapsed(true); localStorage.setItem("retro_sidebar_collapsed", "true"); }}
              title="Collapse sidebar"
              role="button"
              tabIndex={0}
            >
              <ChevronLeft size={18} className="sidebar-expand-icon" />
            </div>
            </>
            )}
            {!sidebarCollapsed && (
              <div
                className="sidebar-resize-handle"
                onMouseDown={(e) => {
                  e.preventDefault();
                  isResizingSidebar.current = true;
                  const startX = e.clientX;
                  const startWidth = sidebarWidth;
                  let latestWidth = startWidth;
                  const onMouseMove = (ev) => {
                    if (!isResizingSidebar.current) return;
                    latestWidth = Math.min(500, Math.max(180, startWidth + ev.clientX - startX));
                    setSidebarWidth(latestWidth);
                  };
                  const onMouseUp = () => {
                    isResizingSidebar.current = false;
                    localStorage.setItem("retro_sidebar_width", String(latestWidth));
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  };
                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                }}
              />
            )}
          </div>

          {/* Context Menu */}
          {contextMenu && (
            <div
              ref={contextMenuRef}
              className="context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.type === "card" && (
                <>
                  {(() => { const ctxCard = cards.find(c => c.id === contextMenu.id); return ctxCard && (isAdmin || isSuperUser || ctxCard.created_by_user_id === user?.id); })() && (
                    <button onClick={() => {
                      const ctxCard = cards.find(c => c.id === contextMenu.id);
                      if (ctxCard) { setEditingCardId(ctxCard.id); setEditCardContent(ctxCard.content || ''); }
                      setContextMenu(null);
                    }}>
                      <Edit2 size={14} /> Edit Card
                    </button>
                  )}
                  {canDeleteCard(cards.find(c => c.id === contextMenu.id) || {}) && (
                    <button onClick={() => { deleteCard(contextMenu.id); setContextMenu(null); }}>
                      <Trash2 size={14} /> Delete Card
                    </button>
                  )}
                </>
              )}
              {contextMenu.type === "column" && (
                <>
                  <button onClick={() => { setAddingCardToColId(contextMenu.id); setContextMenu(null); }}>
                    <Plus size={14} /> Add Card
                  </button>
                  {(isAdmin || isSuperUser) && (
                    <>
                      <hr className="context-menu-divider" />
                      <button onClick={() => { deleteAllCardsInColumn(contextMenu.id); setContextMenu(null); }}>
                        <Trash2 size={14} /> Clear Column
                      </button>
                      <button className="context-menu-danger" onClick={() => { deleteColumn(contextMenu.id); setContextMenu(null); }}>
                        <Trash2 size={14} /> Delete Column
                      </button>
                    </>
                  )}
                </>
              )}
              {contextMenu.type === "addcard" && (
                <>
                  <button onClick={() => { setAddingCardToColId(contextMenu.id); setContextMenu(null); }}>
                    <Plus size={14} /> Add a Card
                  </button>
                </>
              )}
              {contextMenu.type === "user" && (
                <>
                  <div className="context-menu-label">Move to lead…</div>
                  {Object.entries(leadsByDept).map(([dept, leads]) => (
                    leads.length > 0 && (
                      <div key={dept} className="context-menu-dept-group">
                        <button
                          className="context-menu-dept-toggle"
                          onClick={(e) => { e.stopPropagation(); setExpandedDepts(prev => ({ ...prev, [dept]: !prev[dept] })); }}
                        >
                          {expandedDepts[dept] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="context-menu-dept-name">{dept}</span>
                          <span className="context-menu-dept-count">({leads.length})</span>
                        </button>
                        {expandedDepts[dept] && leads.map(lead => (
                          <button key={lead} className="context-menu-dept-lead" onClick={() => {
                            const userId = contextMenu.id;
                            setContextMenu(null);
                            setExpandedDepts({});
                            showConfirm(`Move this user to ${lead} (${dept})?`, async () => {
                              await axios.patch(`${API_URL}/users/${userId}`, { department: dept, lead }, authHeaders(token));
                              setUsersList(prev => prev.map(u => u.id === userId ? { ...u, department: dept, lead } : u));
                            });
                          }}>
                            <MoveRight size={14} /> {lead}
                          </button>
                        ))}
                      </div>
                    )
                  ))}
                  <hr className="context-menu-divider" />
                  {(() => {
                    const u = usersList.find(u => u.id === contextMenu.id);
                    if (!u || u.is_master || u.is_overlord) return null;
                    return (
                      <button onClick={async () => {
                        const userId = contextMenu.id;
                        const newVal = !u.is_admin;
                        setContextMenu(null);
                        try {
                          await axios.patch(`${API_URL}/users/${userId}`, { is_admin: newVal }, authHeaders(token));
                          setUsersList(prev => prev.map(x => x.id === userId ? { ...x, is_admin: newVal } : x));
                          fetchLeads();
                        } catch(e) { console.error(e); }
                      }}>
                        <Settings size={14} /> {u.is_admin ? 'Revoke Admin' : 'Grant Admin'}
                      </button>
                    );
                  })()}
                  {(() => {
                    const u = usersList.find(u => u.id === contextMenu.id);
                    if (!u) return null;
                    const isSelf = u.id === user?.id;
                    if (isSelf) return null;
                    return (
                      <button onClick={async () => {
                        const userId = contextMenu.id;
                        const newVal = !u.is_master;
                        setContextMenu(null);
                        showConfirm(
                          newVal ? `Promote ${u.display_name || u.username} to Master?` : `Demote ${u.display_name || u.username} from Master?`,
                          async () => {
                            try {
                              await axios.patch(`${API_URL}/users/${userId}`, { is_master: newVal }, authHeaders(token));
                              setUsersList(prev => prev.map(x => x.id === userId ? { ...x, is_master: newVal, is_admin: newVal ? 0 : x.is_admin } : x));
                            } catch(e) { console.error(e); }
                          }
                        );
                      }}>
                        <Settings size={14} /> {u.is_master ? 'Revoke Master' : 'Grant Master'}
                      </button>
                    );
                  })()}
                  {(() => {
                    const customRoles = Object.entries(roleLabels).filter(([k]) => !['master', 'admin', 'user'].includes(k));
                    if (customRoles.length === 0) return null;
                    const u = usersList.find(u => u.id === contextMenu.id);
                    if (!u || u.is_master || u.is_overlord) return null;
                    return (
                      <>
                        <hr className="context-menu-divider" />
                        <div className="context-menu-label">Set Role…</div>
                        {customRoles.map(([key, label]) => (
                          <button
                            key={key}
                            className={u.role_key === key ? 'context-menu-active' : ''}
                            onClick={async () => {
                              const userId = contextMenu.id;
                              const newKey = u.role_key === key ? null : key;
                              setContextMenu(null);
                              try {
                                await axios.patch(`${API_URL}/users/${userId}`, { role_key: newKey }, authHeaders(token));
                                setUsersList(prev => prev.map(x => x.id === userId ? { ...x, role_key: newKey } : x));
                              } catch(e) { console.error(e); }
                            }}
                          >
                            {u.role_key === key ? <span>✓</span> : <span style={{display:'inline-block',width:14}} />} {label}
                          </button>
                        ))}
                      </>
                    );
                  })()}
                  {activeBoard && (
                    <>
                      <hr className="context-menu-divider" />
                      <button className="context-menu-danger" onClick={() => {
                        const userId = contextMenu.id;
                        const u = usersList.find(u => u.id === userId);
                        const name = u?.display_name || u?.username || 'this user';
                        setContextMenu(null);
                        showConfirm(`Remove ${name} from this board?`, async () => {
                          await removeBoardMember(activeBoard.id, userId);
                          setBoardUsersList(prev => prev.filter(x => x.id !== userId));
                        });
                      }}>
                        <UserMinus size={14} /> Remove from Board
                      </button>
                    </>
                  )}
                  <hr className="context-menu-divider" />
                  <button className="context-menu-danger" onClick={() => {
                    const userId = contextMenu.id;
                    setContextMenu(null);
                    showConfirm("Permanently delete this user account? This cannot be undone.", () => deleteUser(userId));
                  }}>
                    <Trash2 size={14} /> Delete Account
                  </button>
                </>
              )}
              {contextMenu.type === "board" && (
                <>
                  {(isAdmin || isSuperUser) && (
                    <>
                      <button onClick={() => {
                        if (boards.length === 0) setIsModalOpen(true);
                        else setIsCreatingBoardInline(true);
                        setContextMenu(null);
                      }}>
                        <Plus size={14} /> Add New Board
                      </button>
                      <button onClick={() => { deleteBoard(contextMenu.id, { stopPropagation: () => {} }); setContextMenu(null); }}>
                        <Trash2 size={14} /> Delete Board
                      </button>
                    </>
                  )}
                </>
              )}
              {contextMenu.type === "admin-email" && (
                <>
                  <div className="context-menu-label">{contextMenu.email}</div>
                  <div className="context-menu-label" style={{ fontSize: '0.7rem', opacity: 0.6, paddingTop: 0 }}>Change Department</div>
                  {['QA', 'SE'].filter(d => d !== contextMenu.department).map(d => (
                    <button key={d} onClick={() => { const id = contextMenu.id; setContextMenu(null); updateAdminEmailDept(id, d); }}>
                      <MoveRight size={14} /> Move to {d}
                    </button>
                  ))}
                  <hr className="context-menu-divider" />
                  <button className="context-menu-danger" onClick={() => { const id = contextMenu.id; setContextMenu(null); showConfirm('Remove this email from the admin list?', () => removeAdminEmail(id)); }}>
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              )}
              {contextMenu.type === "master-email" && (
                <>
                  <div className="context-menu-label">{contextMenu.email}</div>
                  <button className="context-menu-danger" onClick={() => { const id = contextMenu.id; setContextMenu(null); showConfirm('Remove this email from the master list?', () => removeMasterEmail(id)); }}>
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              )}
              {contextMenu.type === "board-user" && (
                <>
                  <div className="context-menu-label">{contextMenu.name}</div>
                  <button className="context-menu-danger" onClick={() => {
                    const userId = contextMenu.id;
                    const name = contextMenu.name;
                    setContextMenu(null);
                    showConfirm(`Remove ${name} from this board?`, async () => {
                      await removeBoardMember(activeBoard.id, userId);
                      setBoardUsersList(prev => prev.filter(u => u.id !== userId));
                    });
                  }}>
                    <UserMinus size={14} /> Remove from Board
                  </button>
                </>
              )}
            </div>
          )}

          <div className="board-area" style={activeBoard?.bg_image ? { position: 'relative', overflow: 'hidden', backgroundColor: 'transparent' } : {}}>
            {activeBoard?.bg_image && (
              <>
                {/* Blurred background fill — covers edges without stretching the real image */}
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 0,
                  backgroundImage: `url(${activeBoard.bg_image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(30px)',
                  transform: 'scale(1.1)',
                }} />
                {/* Sharp image — contained at full quality */}
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 0,
                  backgroundImage: `url(${activeBoard.bg_image})`,
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                }} />
              </>
            )}
            {!activeBoard ? (
              <div className="empty-state">
                <div className="empty-state-profile">
                  <div className="profile-dropdown-wrapper">
                    <button
                      className="profile-btn"
                      onClick={(e) => { e.stopPropagation(); setIsProfileOpen(!isProfileOpen); }}
                    >
                      <User size={18} />
                      <span className="profile-btn-name">{user?.display_name || "User"}</span>
                      <ChevronDown size={14} />
                    </button>
                    {isProfileOpen && (
                      <div className="profile-dropdown" onClick={(e) => e.stopPropagation()}>
                        <button onClick={openSettings}>
                          <Settings size={16} /> Settings
                        </button>
                        <hr className="profile-dropdown-divider" />
                        <button className="profile-logout-btn" onClick={() => { setIsProfileOpen(false); logout(); }}>
                          <LogOut size={16} /> Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <p>Select a board from the sidebar to get started.</p>
                {(isAdmin || isSuperUser) && (
                  <button
                    className="create-btn"
                    style={{ marginTop: "20px" }}
                    onClick={() => setIsModalOpen(true)}
                  >
                    <Plus size={16} style={{ marginRight: "8px" }} />
                    Create a New Board
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className={`board-header${activeBoard?.bg_image ? ' has-bg' : ''}`}>
                  <div className="board-title-container">
                    {isEditingBoard ? (
                      <h1 className="board-title">
                        <input
                          autoFocus
                          className="edit-board-input"
                          value={editBoardName}
                          onChange={(e) => setEditBoardName(e.target.value)}
                          onBlur={updateBoardName}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateBoardName();
                            if (e.key === "Escape") setIsEditingBoard(false);
                          }}
                        />
                        <button
                          className="edit-board-btn"
                          onClick={updateBoardName}
                          title="Save Board Name"
                        >
                          <Check size={18} />
                        </button>
                      </h1>
                    ) : (
                      <h1 className="board-title">
                        <span
                          className={(isAdmin || isSuperUser) ? "board-title-text board-title-editable" : "board-title-text"}
                          onClick={(isAdmin || isSuperUser) ? () => { setEditBoardName(activeBoard.name); setIsEditingBoard(true); } : undefined}
                          title={(isAdmin || isSuperUser) ? "Click to edit board name" : undefined}
                        >
                          {activeBoard.name}
                        </span>
                        {(isAdmin || isSuperUser) && (
                          <button
                            className="edit-board-btn"
                            onClick={() => {
                              setEditBoardName(activeBoard.name);
                              setIsEditingBoard(true);
                            }}
                            title="Edit Board Name"
                          >
                            <Edit2 size={18} />
                          </button>
                        )}
                      </h1>
                    )}
                  </div>
                  {(isAdmin || isSuperUser) && (
                    <button
                      className="bg-picker-btn"
                      title="Change background"
                      onClick={() => { setBgPickerUrl(activeBoard?.bg_image || ""); setShowBgPicker(true); }}
                    >
                      <Image size={15} /> Background
                    </button>
                  )}
                  <div className="add-column">
                    {(isAdmin || isSuperUser) && isAddingColumn ? (
                      <>
                        <input
                          autoFocus
                          value={newColName}
                          onChange={(e) => setNewColName(e.target.value)}
                          placeholder="New Column Name..."
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addColumn();
                            if (e.key === "Escape") {
                              setIsAddingColumn(false);
                              setNewColName("");
                            }
                          }}
                          onBlur={(e) => {
                            if (
                              e.relatedTarget &&
                              e.relatedTarget.id === "save-col-btn"
                            )
                              return;
                            setIsAddingColumn(false);
                            setNewColName("");
                          }}
                        />
                        <button
                          id="save-col-btn"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addColumn();
                          }}
                        >
                          Save
                        </button>
                      </>
                    ) : (isAdmin || isSuperUser) ? (
                      <button onClick={() => setIsAddingColumn(true)}>
                        Add Column
                      </button>
                    ) : null}
                  </div>
                  <div className="board-users-dropdown-wrapper">
                    {(isAdmin || isSuperUser) && (
                      <button
                        className="board-users-btn"
                        title="Manage board members"
                        onClick={openMembersPanel}
                      >
                        <UserPlus size={15} />
                      </button>
                    )}
                    <button
                      className="board-users-btn"
                      onClick={toggleBoardUsersDropdown}
                      title="View board users"
                    >
                      <Users size={16} />
                      <span className="board-users-count">{isBoardUsersOpen ? '' : boardUsersList.length || ''}</span>
                      <ChevronDown size={14} className={isBoardUsersOpen ? 'chevron-open' : ''} />
                    </button>
                    {isBoardUsersOpen && (
                      <div className="board-users-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div className="board-users-dropdown-header">
                          <Users size={14} /> Board Users ({boardUsersList.length})
                        </div>
                        {boardUsersList.length === 0 ? (
                          <div className="board-users-empty">No users found</div>
                        ) : (
                          <ul className="board-users-list">
                            {boardUsersList.map(u => (
                              <li key={u.id} className="board-users-item"
                                onContextMenu={(e) => {
                                  if ((isAdmin || isSuperUser) && !u.is_pending) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextMenu({ x: e.clientX, y: e.clientY, type: 'board-user', id: u.id, name: u.display_name });
                                  }
                                }}
                              >
                                <div className="board-users-avatar" style={{ background: getAvatarColor(u.display_name, isDarkTheme) }}>{getInitials(u.display_name)}</div>
                                <div className="board-users-info">
                                  <span className="board-users-name">{u.display_name}</span>
                                  <span className="board-users-role">
                                    {u.is_pending ? 'Pending Invite' : (u.is_overlord ? 'Overlord' : u.is_master ? 'Iron Fist' : u.is_admin ? 'Admin' : 'Member')}
                                    {u.department ? ` · ${u.department}` : ''}
                                    {u.is_pending ? ' · PENDING' : ''}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="profile-dropdown-wrapper">
                    <button
                      className="profile-btn"
                      onClick={(e) => { e.stopPropagation(); setIsProfileOpen(!isProfileOpen); }}
                    >
                      <User size={18} />
                      <span className="profile-btn-name">{user?.display_name || "User"}</span>
                      {isSuperUser
                        ? <span className="profile-btn-master-badge">Iron Fist</span>
                        : isAdmin && <span className="profile-btn-admin-badge">Admin</span>}
                      <ChevronDown size={14} />
                    </button>
                    {isProfileOpen && (
                      <div className="profile-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div className="profile-dropdown-header">
                          <div className="profile-dropdown-meta">
                            {user?.department && <span className="profile-dept-badge">{user.department}</span>}
                            {isSuperUser
                              ? <span className="profile-master-badge">Iron Fist</span>
                              : isAdmin && <span className="profile-admin-badge">Admin</span>}
                          </div>
                        </div>
                        <button onClick={openSettings}>
                          <Settings size={16} /> Settings
                        </button>
                        <button onClick={() => { setIsProfileOpen(false); alert("Vault Jump Retro v1.0\nBuilt with React + Vite"); }}>
                          <Info size={16} /> About
                        </button>
                        <hr className="profile-dropdown-divider" />
                        <button className="profile-logout-btn" onClick={() => { setIsProfileOpen(false); logout(); }}>
                          <LogOut size={16} /> Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <DragDropContext onDragStart={() => { isDraggingRef.current = true; }} onDragEnd={onDragEnd}>
                  <Droppable
                    droppableId="board"
                    type="COLUMN"
                    direction="horizontal"
                  >
                    {(provided) => (
                      <div
                        className="columns-wrapper"
                        ref={(el) => {
                          provided.innerRef(el);
                          columnsWrapperRef.current = el;
                        }}
                        {...provided.droppableProps}
                        onMouseDown={handlePanStart}
                        onMouseMove={handlePanMove}
                        onMouseUp={handlePanEnd}
                        onMouseLeave={handlePanEnd}
                      >
                        {columns.map((col, index) => (
                          <Draggable
                            key={col.id}
                            draggableId={`col-${col.id}`}
                            index={index}
                            isDragDisabled={!isAdmin && !isSuperUser}
                          >
                            {(provided) => (
                              <div
                                className="column"
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                              >
                                <div
                                  className="column-header"
                                  {...provided.dragHandleProps}
                                  onMouseEnter={() =>
                                    setHoveredColumnId(col.id)
                                  }
                                  onMouseLeave={() => setHoveredColumnId(null)}
                                  onContextMenu={(e) => handleContextMenu(e, "column", col.id)}
                                >
                                  <div className="column-header-actions">
                                    {(isAdmin || isSuperUser) && hoveredColumnId === col.id && (
                                      <button
                                        className="delete-column-btn"
                                        onClick={() => deleteColumn(col.id)}
                                        title="Delete Column"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    )}
                                  </div>
                                  {(isAdmin || isSuperUser) && editingColumnId === col.id ? (
                                    <input
                                      autoFocus
                                      className="edit-column-input"
                                      value={editColumnName}
                                      onChange={(e) =>
                                        setEditColumnName(e.target.value)
                                      }
                                      onBlur={updateColumnName}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          updateColumnName();
                                        if (e.key === "Escape")
                                          setEditingColumnId(null);
                                      }}
                                    />
                                  ) : (
                                    <h3
                                      className="column-title"
                                      onClick={() => {
                                        if (!(isAdmin || isSuperUser)) return;
                                        setEditingColumnId(col.id);
                                        setEditColumnName(col.name);
                                      }}
                                      title={(isAdmin || isSuperUser) ? "Click to edit" : undefined}
                                      style={(isAdmin || isSuperUser) ? undefined : { cursor: 'default' }}
                                    >
                                      {col.name}
                                    </h3>
                                  )}
                                </div>

                                <div className="add-card-container">
                                  {addingCardToColId === col.id ? (
                                    <div className="add-card-form" ref={addCardFormRef}>
                                      <textarea
                                        className="add-card-textarea"
                                        placeholder="Enter a title for this card..."
                                        autoFocus
                                        value={newCardContent}
                                        onChange={(e) => {
                                          setNewCardContent(e.target.value);
                                          e.target.style.height = 'auto';
                                          e.target.style.height = e.target.scrollHeight + 'px';
                                        }}
                                        onPaste={handleNewCardPaste}
                                        onKeyDown={(e) => {
                                          if (
                                            e.key === "Enter" &&
                                            !e.shiftKey
                                          ) {
                                            e.preventDefault();
                                            if (newCardContent.trim() || newCardImageUrl) {
                                              addCard(
                                                col.id,
                                                newCardContent.trim() || "",
                                                newCardImageUrl || undefined,
                                              );
                                              setNewCardContent("");
                                              setNewCardImageUrl("");
                                              setAddingCardToColId(null);
                                            }
                                          }
                                          if (e.key === "Escape") {
                                            setAddingCardToColId(null);
                                            setNewCardContent("");
                                            setNewCardImageUrl("");
                                          }
                                        }}
                                      />
                                      {newCardImageUrl && (
                                        <div className="card-img-preview">
                                          <img src={newCardImageUrl} alt="preview" />
                                          <button className="card-img-remove" onClick={() => setNewCardImageUrl("")}><X size={12} /></button>
                                        </div>
                                      )}
                                      <div className="add-card-actions">
                                        <button
                                          className="add-card-primary-btn"
                                          onClick={() => {
                                            if (newCardContent.trim() || newCardImageUrl) {
                                              addCard(
                                                col.id,
                                                newCardContent.trim() || "",
                                                newCardImageUrl || undefined,
                                              );
                                              setNewCardContent("");
                                              setNewCardImageUrl("");
                                              setAddingCardToColId(null);
                                            }
                                          }}
                                        >
                                          Add card
                                        </button>
                                        <button
                                          className="add-card-img-btn"
                                          title="Attach image"
                                          onClick={() => cardImageInputRef.current?.click()}
                                        >
                                          <Image size={16} />
                                        </button>
                                        <button
                                          className="add-card-img-btn"
                                          title="GIF Library"
                                          onClick={() => openGifPicker('new-card')}
                                        >
                                          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: '16px', display: 'block', height: 16 }}>GIF</span>
                                        </button>
                                        <input
                                          ref={cardImageInputRef}
                                          type="file"
                                          accept="image/*"
                                          style={{ display: 'none' }}
                                          onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            try {
                                              const url = await uploadImageFile(file);
                                              setNewCardImageUrl(url);
                                            } catch (err) { console.error('Upload failed', err); }
                                            e.target.value = '';
                                          }}
                                        />
                                        <button
                                          className="add-card-cancel"
                                          onClick={() => {
                                            setAddingCardToColId(null);
                                            setNewCardContent("");
                                            setNewCardImageUrl("");
                                          }}
                                        >
                                          <X size={20} />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      className="add-card-btn"
                                      onClick={() =>
                                        setAddingCardToColId(col.id)
                                      }
                                      onContextMenu={(e) => handleContextMenu(e, "addcard", col.id)}
                                    >
                                      <Plus size={16} /> Add a card
                                    </button>
                                  )}
                                </div>

                                <Droppable droppableId={String(col.id)} type="CARD">
                                  {(provided) => (
                                    <div
                                      className="cards-container"
                                      ref={provided.innerRef}
                                      {...provided.droppableProps}
                                    >
                                      {cards
                                        .filter((c) => c.column_id === col.id)
                                        .sort((a, b) => a.position - b.position)
                                        .map((card, index) => (
                                          <Draggable
                                            key={card.id}
                                            draggableId={`card-${card.id}`}
                                            index={index}
                                            isDragDisabled={!isAdmin && !isSuperUser && card.created_by_user_id !== user?.id}
                                          >
                                            {(provided) => (
                                              <div
                                                className="card"
                                                ref={(el) => {
                                                  provided.innerRef(el);
                                                  if (editingCardId === card.id) editingCardRef.current = el;
                                                }}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                onContextMenu={(e) => handleContextMenu(e, "card", card.id)}
                                                onPaste={(e) => handleCardPaste(e, card.id)}
                                                onMouseDown={() => { if (window.getSelection()?.toString()) window.getSelection().removeAllRanges(); }}
                                              >
                                                <div className="card-drag-handle">
                                                  <GripVertical size={16} />
                                                </div>
                                                <div
                                                  className="card-content-wrapper"
                                                  style={{ flex: 1, minWidth: 0 }}
                                                >
                                                  {(card.image_url || isImageUrl(card.content)) && (
                                                    <img
                                                      className="card-image"
                                                      src={card.image_url || card.content}
                                                      alt=""
                                                      onError={(e) => { e.target.style.display = 'none'; }}
                                                      onClick={() => {
                                                        if (isAdmin || isSuperUser || card.created_by_user_id === user?.id) {
                                                          setEditingCardId(card.id);
                                                          setEditCardContent(card.content || '');
                                                        }
                                                      }}
                                                      style={{ cursor: (isAdmin || isSuperUser || card.created_by_user_id === user?.id) ? 'pointer' : undefined }}
                                                    />
                                                  )}
                                                  {editingCardId === card.id ? (
                                                    <div className="edit-card-container">
                                                      <textarea
                                                        autoFocus
                                                        className="edit-card-textarea"
                                                        value={editCardContent}
                                                        onChange={(e) => {
                                                          setEditCardContent(e.target.value);
                                                          e.target.style.height = 'auto';
                                                          e.target.style.height = e.target.scrollHeight + 'px';
                                                        }}
                                                        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                                        onPaste={(e) => handleCardPaste(e, card.id)}
                                                        onKeyDown={(e) => {
                                                          if (
                                                            e.key === "Enter" &&
                                                            !e.shiftKey
                                                          ) {
                                                            e.preventDefault();
                                                            updateCardContent();
                                                          }
                                                          if (
                                                            e.key === "Escape"
                                                          ) {
                                                            setEditingCardId(
                                                              null,
                                                            );
                                                            setEditCardContent(
                                                              "",
                                                            );
                                                          }
                                                        }}
                                                        onPointerDown={(e) =>
                                                          e.stopPropagation()
                                                        }
                                                      />
                                                      <div className="edit-card-actions">
                                                        <button
                                                          className="add-card-img-btn"
                                                          title="Choose GIF"
                                                          onPointerDown={(e) => e.stopPropagation()}
                                                          onClick={() => openGifPicker({ editCardId: card.id })}
                                                        >
                                                          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: '16px', display: 'block', height: 16 }}>GIF</span>
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div
                                                      className="card-content"
                                                      onMouseDown={(e) => e.stopPropagation()}
                                                      onClick={(e) => {
                                                        if (window.getSelection()?.toString())
                                                          return;
                                                        if (!isAdmin && !isSuperUser && card.created_by_user_id !== user?.id)
                                                          return;
                                                        setEditingCardId(
                                                          card.id,
                                                        );
                                                        setEditCardContent(
                                                          card.content || '',
                                                        );
                                                      }}
                                                    >
                                                      {card.content && !isImageUrl(card.content) && card.content}
                                                    </div>
                                                  )}
                                                  {/* Reactions */}
                                                  {(card.reactions?.length > 0 || card.created_by) && (
                                                    <div className="card-footer">
                                                      <div className="card-reactions">
                                                        {(() => {
                                                          const grouped = {};
                                                          (card.reactions || []).forEach(r => {
                                                            if (!grouped[r.emoji]) grouped[r.emoji] = [];
                                                            grouped[r.emoji].push(r);
                                                          });
                                                          return Object.entries(grouped).map(([emoji, users]) => (
                                                            <button
                                                              key={emoji}
                                                              className={`card-reaction-badge${users.some(u => u.user_id === user?.id) ? ' card-reaction-mine' : ''}`}
                                                              title={users.map(u => u.display_name).join(', ')}
                                                              onClick={(e) => { e.stopPropagation(); toggleReaction(card.id, emoji); }}
                                                              onPointerDown={(e) => e.stopPropagation()}
                                                            >
                                                              {emoji} {users.length}
                                                            </button>
                                                          ));
                                                        })()}
                                                        <button
                                                          className="card-reaction-add"
                                                          title="Add reaction"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (reactionPickerCardId === card.id) {
                                                              setReactionPickerCardId(null);
                                                              setReactionPickerPos(null);
                                                            } else {
                                                              const rect = e.currentTarget.getBoundingClientRect();
                                                              setReactionPickerPos({ top: rect.top, left: rect.left, width: rect.width });
                                                              setReactionPickerCardId(card.id);
                                                            }
                                                          }}
                                                          onPointerDown={(e) => e.stopPropagation()}
                                                        >
                                                          <SmilePlus size={14} />
                                                        </button>
                                                        {reactionPickerCardId === card.id && reactionPickerPos && createPortal(
                                                          <div className="card-reaction-picker" style={{ position: 'fixed', top: reactionPickerPos.top - 44, left: reactionPickerPos.left - 100, bottom: 'auto' }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                                                            {REACTION_EMOJIS.map(emoji => (
                                                              <button key={emoji} className="card-reaction-picker-item" onClick={() => toggleReaction(card.id, emoji)}>
                                                                {emoji}
                                                              </button>
                                                            ))}
                                                          </div>,
                                                          document.body
                                                        )}
                                                      </div>
                                                      {card.created_by && (
                                                        <span className="card-avatar" title={card.created_by} style={{ background: getAvatarColor(card.created_by, isDarkTheme) }}>
                                                          {getInitials(card.created_by)}
                                                        </span>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="card-action-buttons">
                                                  <button
                                                    className="del-btn"
                                                    onClick={() =>
                                                      deleteCard(card.id)
                                                    }
                                                    style={{ display: canDeleteCard(card) ? undefined : 'none' }}
                                                    title="Delete card"
                                                  >
                                                    <Trash2 size={16} />
                                                  </button>
                                                  {editingCardId === card.id && (
                                                    <button
                                                      className="edit-card-cancel-btn"
                                                      title="Cancel (Esc)"
                                                      onPointerDown={(e) => e.stopPropagation()}
                                                      onClick={() => { setEditingCardId(null); setEditCardContent(""); }}
                                                    >
                                                      <X size={14} />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            )}
                                          </Draggable>
                                        ))}
                                      {provided.placeholder}
                                    </div>
                                  )}
                                </Droppable>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </>
            )}
          </div>
        </div>
      </ErrorBoundary>
    );
};
export default App;
