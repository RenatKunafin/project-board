import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SDK = '@project-board/widget-sdk';
const UI_PACKAGES = ['react-dom', 'react-calendar-timeline', 'react-grid-layout', 'react-rnd', 'lucide-react'];
const matchesPackage = (source, name) => source === name || source.startsWith(`${name}/`);
const inside = (root, file) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

function packagesIn(root) {
  return ['packages', 'examples', 'apps'].flatMap((base) => {
    const directory = join(root, base);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      const manifest = join(path, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifest)) return [];
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      const role = base === 'apps' ? 'app'
        : base === 'packages' && entry.name === 'widget-sdk' ? 'sdk'
          : base === 'packages' && entry.name === 'dashboard' ? 'platform' : 'module';
      return [{ name, path, role }];
    });
  });
}

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

export function createPackageBoundaryRule(root) {
  const packages = packagesIn(root);
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        boundary: 'ADR PBT-002: {{owner}} не может импортировать {{target}}. Между пакетами доступен только публичный widget-sdk.',
        database: 'ADR PBT-002: прямой доступ к Dexie разрешён только адаптеру платформы dashboard.',
        sdkUi: 'ADR PBT-002: SDK не зависит от UI-библиотек предметных модулей ({{source}}).',
      },
    },
    create(context) {
      const file = context.filename;
      const owner = packages.find((pkg) => inside(pkg.path, file));
      function check(node) {
        const source = literal(node);
        if (source === undefined) return;
        const pathImport = source.startsWith('.') || isAbsolute(source);
        const targetPath = pathImport ? resolve(dirname(file), source) : undefined;
        const segments = targetPath?.split(sep);
        const throughNodeModules = segments?.includes('node_modules');
        const dependency = throughNodeModules
          ? segments.slice(segments.lastIndexOf('node_modules') + 1).join('/') : source;
        if (matchesPackage(dependency, 'dexie') && owner?.role !== 'platform') {
          context.report({ node, messageId: 'database' });
          return;
        }
        if (!owner || owner.role === 'app') return;
        if (owner.role === 'sdk' && (dependency.startsWith('@svar-ui/') || UI_PACKAGES.some((name) => matchesPackage(dependency, name)))) {
          context.report({ node, messageId: 'sdkUi', data: { source } });
          return;
        }
        const target = packages.find((pkg) => pathImport && !throughNodeModules
          ? inside(pkg.path, targetPath) : matchesPackage(dependency, pkg.name));
        if (pathImport && inside(owner.path, targetPath) && (!target || target === owner)) return;
        if (!pathImport && matchesPackage(source, owner.name)) return;
        if (!pathImport && source === SDK && owner.role !== 'sdk') return;
        if (pathImport || target || dependency.startsWith('@project-board/')) {
          context.report({ node, messageId: 'boundary', data: { owner: owner.name, target: target?.name ?? source } });
        }
      }
      return {
        ImportDeclaration: (node) => check(node.source),
        ExportNamedDeclaration: (node) => check(node.source),
        ExportAllDeclaration: (node) => check(node.source),
        ImportExpression: (node) => check(node.source),
        TSImportType: (node) => check(node.source),
        TSExternalModuleReference: (node) => check(node.expression),
        CallExpression(node) {
          if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
          // Локальная функция с именем require не является загрузчиком Node.
          let scope = context.sourceCode.getScope(node);
          while (scope) {
            if (scope.set.get('require')?.defs.length) return;
            scope = scope.upper;
          }
          check(node.arguments[0]);
        },
      };
    },
  };
}
