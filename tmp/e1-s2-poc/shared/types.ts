export type Finding = {
  code: string;
  message: string;
  blocking: boolean;
  path: string; // JSON Pointer, "" for top-level
  line?: number;
  column?: number;
  relatedLocations?: { path: string; message: string }[];
  details?: Record<string, unknown>;
};

export type ValidationResult = {
  findings: Finding[];
  validForPublication: boolean;
};

export type WorkflowInput = Record<string, unknown>;
export type StepId = string;
