const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request<T>(endpoint: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function get<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function del(endpoint: string): Promise<void> {
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || err.detail || `Delete failed: ${res.status}`);
  }
}

// ── Recolor Room ──────────────────────────────────────────────────────
export interface RecolorRequest {
  imageBase64: string;
  targetColor: string;
  intensity: number;
  selectedWalls?: string[];
}

export interface RecolorResponse {
  image: string;
}

export async function recolorRoom(body: RecolorRequest): Promise<RecolorResponse> {
  return request<RecolorResponse>("/api/recolor", body);
}

// NEW: recolor using pre-computed masks (no re-detection needed)
export interface RecolorWithMasksRequest {
  imageBase64: string;
  masks: string[];        // base64 PNG masks for selected walls
  targetColor: string;
  intensity: number;
}

export async function recolorWithMasks(body: RecolorWithMasksRequest): Promise<RecolorResponse> {
  return request<RecolorResponse>("/api/recolor-masks", body);
}

// ── Detect Walls ──────────────────────────────────────────────────────
export interface DetectWallsRequest {
  imageBase64: string;
  color?: string;
  intensity?: number;
}

export interface WallRegion {
  id: string;
  type: string;
  mask: string;
}

export interface DetectWallsResponse {
  regions: WallRegion[];
  recolored: string;
}

export async function detectWalls(body: DetectWallsRequest): Promise<DetectWallsResponse> {
  return request<DetectWallsResponse>("/api/pro-detect", body);
}

// ── Color Recommendations ─────────────────────────────────────────────
export interface RecommendColorsRequest {
  roomType: string;
  imageBase64?: string;
}

export interface ColorSuggestion {
  hex: string;
  name: string;
  reason: string;
}

export interface RecommendColorsResponse {
  suggestions: ColorSuggestion[];
}

export async function recommendColors(body: RecommendColorsRequest): Promise<RecommendColorsResponse> {
  return request<RecommendColorsResponse>("/api/recommend-colors", body);
}

// ── Saved Results ─────────────────────────────────────────────────────
export interface SavedResult {
  id: string;
  color_hex: string;
  intensity: number;
  share_id: string | null;
  created_at: string;
  original_image_url?: string;
  result_image_url?: string;
}

export interface SaveResultRequest {
  color_hex: string;
  intensity: number;
}

export async function getSavedResults(): Promise<SavedResult[]> {
  return get<SavedResult[]>("/api/results");
}

export async function saveResult(data: SaveResultRequest & {
  original_image_url?: string;
  result_image_url?: string;
}): Promise<SavedResult> {
  const { original_image_url, result_image_url, ...dbData } = data;
  const saved = await request<SavedResult>("/api/results", dbData);
  if (original_image_url || result_image_url) {
    const local = getLocalImages();
    local[saved.id] = { original_image_url, result_image_url };
    setLocalImages(local);
  }
  return { ...saved, original_image_url, result_image_url };
}

export async function deleteResult(id: string): Promise<void> {
  await del(`/api/results/${id}`);
  const local = getLocalImages();
  delete local[id];
  setLocalImages(local);
}

export async function getResultByShareId(shareId: string): Promise<SavedResult | null> {
  try {
    const result = await get<SavedResult>(`/api/results/share/${shareId}`);
    const local = getLocalImages();
    const images = local[result.id] || {};
    return { ...result, ...images };
  } catch {
    return null;
  }
}

type LocalImages = Record<string, { original_image_url?: string; result_image_url?: string }>;
const LOCAL_KEY = "roomtint_images";

function getLocalImages(): LocalImages {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); }
  catch { return {}; }
}

function setLocalImages(data: LocalImages) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

export function getLocalImagesForResult(id: string) {
  return getLocalImages()[id] || {};
}
