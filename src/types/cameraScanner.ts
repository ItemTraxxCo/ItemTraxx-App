export type ScannerStatus = "success" | "low_light" | "glare" | "blurry" | "unscannable";

export type ScannerMode =
  | "borrower"
  | "checkout_item"
  | "admin_item_create"
  | "admin_item_edit"
  | "admin_quick_return";

export type ScannerBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScannerScanEvent = {
  value: string;
  timestamp: string;
  status: ScannerStatus;
  boundingBox: ScannerBoundingBox | null;
  mode: ScannerMode;
};

export type ScannerStatusEvent = {
  status: ScannerStatus;
  timestamp: string;
  message: string;
  mode: ScannerMode;
  value?: string;
  boundingBox?: ScannerBoundingBox | null;
};

export type ScannerCapabilityState = {
  cameraSupported: boolean;
  barcodeDetectorSupported: boolean;
  flashlightSupported: boolean;
  canFlipCamera: boolean;
};

export type ScannerHistoryItem = {
  id: string;
  label: string;
  value: string;
  tagLabel?: string;
  tagClass?: string;
  removable?: boolean;
};
