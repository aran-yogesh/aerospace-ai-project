// GENERATED FILE: do not edit. Source: backend/app/schema/api.py
// Regenerate with `make types`.

import type { ParseError } from "./geometry"

export interface FileInfo {
  id: string
  project_id: string
  filename: string
  size_bytes: number
  status: "uploaded" | "parsing" | "parsed" | "failed"
  /** Set when status is failed. */
  error: ParseError | null
  parser_version: string | null
  parse_seconds: number | null
  component_count: number | null
  created_at: string
}

/** Pushed on /ws/files/{id} on connect and on every status change. */
export interface FileStatusEvent {
  file_id: string
  status: "uploaded" | "parsing" | "parsed" | "failed"
  error: ParseError | null
  parse_seconds: number | null
  component_count: number | null
}

export interface Project {
  id: string
  name: string
  created_at: string
  latest_file: FileInfo | null
}

export interface ProjectCreate {
  name: string
}

export interface ProjectDetail {
  id: string
  name: string
  created_at: string
  latest_file: FileInfo | null
  /** Newest first. */
  files: FileInfo[]
}

export interface ProjectList {
  /** Newest first. */
  items: Project[]
}

export type FileStatus = FileInfo["status"]
