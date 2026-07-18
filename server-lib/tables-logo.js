// server-lib/tables-logo.js  —  Print logo data URI utility
import { __dirname } from "./core.js";
import path from "path";
import fs from "fs/promises";

let printLogoDataUriCache = null;

async function getPrintLogoDataUri() {
  if (printLogoDataUriCache) return printLogoDataUriCache;
  try {
    const logoPath = path.join(__dirname, "imagenes", "JDL_negro.png");
    const buf = await fs.readFile(logoPath);
    printLogoDataUriCache = `data:image/png;base64,${buf.toString("base64")}`;
    return printLogoDataUriCache;
  } catch { return "/imagenes/JDL_negro.png"; }
}

export { getPrintLogoDataUri };
