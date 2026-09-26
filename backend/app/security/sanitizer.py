import os
import re
from pathlib import Path

# Reserved filenames on Windows that could cause denial of service or crashes
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10))
}

class PathTraversalError(PermissionError):
    """Raised when an incoming file path attempts to escape the destination boundary."""
    pass

class InvalidFileNameError(ValueError):
    """Raised when a filename contains malicious characters or reserved names."""
    pass

def sanitize_filename(filename: str) -> str:
    """
    Sanitizes a single filename (not path), stripping dangerous characters,
    null bytes, and Windows reserved device names.
    """
    if not filename or not filename.strip():
        raise InvalidFileNameError("Filename cannot be empty")
    
    # Strip null bytes and control chars
    clean = filename.replace("\0", "").strip()
    
    # Remove directory separators if passed into single filename
    clean = os.path.basename(clean.replace("\\", "/"))
    
    # Remove leading dots to prevent hidden/dot-dot files
    clean = clean.lstrip(".")
    if not clean:
        clean = "unnamed_file"

    # Check for Windows reserved names (e.g. CON.txt, NUL)
    stem = Path(clean).stem.upper()
    if stem in WINDOWS_RESERVED_NAMES:
        clean = f"safe_{clean}"

    # Replace forbidden path characters
    clean = re.sub(r'[\x00-\x1f<>:"/\\|?*]', '_', clean)
    return clean

def sanitize_relative_path(relative_path: str) -> str:
    """
    Sanitizes a relative directory path (for folder transfer preservation).
    Strictly removes '..', drive letters (e.g. C:), leading slashes, and null bytes.
    """
    if not relative_path:
        return ""
    
    # Remove null bytes
    path_str = relative_path.replace("\0", "").strip()
    
    # Strip Windows drive letters (e.g. "C:", "D:")
    path_str = re.sub(r'^[a-zA-Z]:', '', path_str)
    
    # Normalize slashes to forward slash
    path_str = path_str.replace("\\", "/")
    
    # Split segments and filter out '.' and empty segments
    segments = [s.strip() for s in path_str.split("/") if s.strip() and s.strip() != "."]
    
    # Strictly check for and reject any '..' segments
    safe_segments = []
    for seg in segments:
        if seg == "..":
            raise PathTraversalError(f"Path traversal detected with '..' in path: {relative_path}")
        safe_segments.append(sanitize_filename(seg))
        
    return "/".join(safe_segments)

def resolve_safe_destination_path(destination_dir: str | Path, relative_path: str, filename: str) -> Path:
    """
    Resolves the absolute destination file path and cryptographically guarantees
    that the target lies strictly inside destination_dir.
    Raises PathTraversalError if target escapes destination root.
    """
    dest_root = Path(destination_dir).resolve()
    
    safe_rel = sanitize_relative_path(relative_path)
    safe_file = sanitize_filename(filename)
    
    if safe_rel:
        target_path = (dest_root / safe_rel / safe_file).resolve()
    else:
        target_path = (dest_root / safe_file).resolve()
        
    # Boundary check: target_path must be a child of dest_root
    try:
        target_path.relative_to(dest_root)
    except ValueError:
        raise PathTraversalError(
            f"Access Denied: Attempted path escape '{target_path}' outside destination '{dest_root}'"
        )
        
    return target_path

def resolve_safe_conflict_name(destination_dir: str | Path, relative_path: str, filename: str, mode: str = "keep_both") -> Path:
    """
    Handles file conflicts:
    - mode='replace': returns original target
    - mode='keep_both': if exists, appends (1), (2), etc.
    - mode='skip': raises FileExistsError
    """
    target = resolve_safe_destination_path(destination_dir, relative_path, filename)
    if not target.exists():
        return target
        
    if mode == "replace":
        return target
    elif mode == "skip":
        raise FileExistsError(f"File {target.name} already exists and mode is skip.")
    elif mode == "keep_both":
        parent = target.parent
        stem = target.stem
        suffix = target.suffix
        counter = 1
        while True:
            candidate = parent / f"{stem} ({counter}){suffix}"
            if not candidate.exists() and not candidate.with_suffix(candidate.suffix + ".qrdrop.partial").exists():
                return candidate
            counter += 1
    return target
