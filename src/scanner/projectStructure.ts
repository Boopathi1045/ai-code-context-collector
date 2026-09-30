import * as path from 'path';

interface TreeNode {
  name: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
}

export class ProjectStructure {
  /**
   * Generates a clean text tree of relative file paths.
   */
  public static generateTree(relativeFilePaths: string[]): string {
    if (!relativeFilePaths || relativeFilePaths.length === 0) {
      return '';
    }

    const root: TreeNode = {
      name: '',
      isDir: true,
      children: new Map(),
    };

    // Sort paths for consistent tree ordering
    const sortedPaths = [...relativeFilePaths].sort();

    for (const relPath of sortedPaths) {
      const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            isDir: !isLast,
            children: new Map(),
          });
        }
        current = current.children.get(part)!;
      }
    }

    const lines: string[] = [];
    this.renderNode(root, '', true, lines);
    return lines.join('\n');
  }

  private static renderNode(
    node: TreeNode,
    prefix: string,
    isRoot: boolean,
    lines: string[]
  ): void {
    const entries = Array.from(node.children.values()).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((child, index) => {
      const isLastChild = index === entries.length - 1;
      const marker = isLastChild ? '└── ' : '├── ';
      lines.push(`${prefix}${marker}${child.name}${child.isDir ? '/' : ''}`);

      if (child.isDir) {
        const nextPrefix = prefix + (isLastChild ? '    ' : '│   ');
        this.renderNode(child, nextPrefix, false, lines);
      }
    });
  }
}
