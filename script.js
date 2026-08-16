"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/manifest.js
  var require_manifest = __commonJS({
    "node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/manifest.js"(exports, module) {
      "use strict";
      function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }
      function hasText(value) {
        if (typeof value === "string") return value.trim().length > 0;
        if (!isObject(value)) return false;
        return Object.values(value).some((item) => typeof item === "string" && item.trim());
      }
      function isLocalPath(value) {
        if (typeof value !== "string" || !value) return false;
        const normalized = value.replaceAll("\\", "/");
        if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
        return !normalized.split("/").some((part) => part === "..") && normalized !== ".";
      }
      function validateManifest(manifest) {
        const errors = [];
        if (!isObject(manifest)) return ["manifest must be an object"];
        if (!hasText(manifest.name)) errors.push("name is required");
        if (typeof manifest.short !== "string" || !/^[A-Za-z0-9_-]+$/.test(manifest.short) || manifest.short === "default") {
          errors.push("short must contain only letters, digits, '_' and '-', and cannot be 'default'");
        }
        if (manifest.entry !== void 0 && !isLocalPath(manifest.entry)) {
          errors.push("entry must be a relative path inside the plugin directory");
        }
        if (manifest.icon !== void 0 && manifest.icon !== "" && !isLocalPath(manifest.icon)) {
          errors.push("icon must be a relative path inside the plugin directory");
        }
        if (manifest.version !== void 0 && typeof manifest.version !== "string") {
          errors.push("version must be a string");
        }
        if (manifest.komari !== void 0 && typeof manifest.komari !== "string") {
          errors.push("komari must be a string");
        }
        if (manifest.configuration !== void 0) {
          if (!isObject(manifest.configuration) || manifest.configuration.type !== "managed" || !Array.isArray(manifest.configuration.data)) {
            errors.push("configuration must be a managed configuration with a data array");
          } else {
            const itemTypes = /* @__PURE__ */ new Set(["string", "number", "select", "switch", "title", "textbox", "richtext", "nodes", "pingtasks"]);
            manifest.configuration.data.forEach((item, index) => {
              if (!isObject(item)) {
                errors.push(`configuration.data[${index}] must be an object`);
                return;
              }
              if (item.type !== "title" && item.type !== "textbox" && (typeof item.key !== "string" || !item.key.trim())) errors.push(`configuration.data[${index}].key is required`);
              if (!hasText(item.name)) errors.push(`configuration.data[${index}].name is required`);
              if (!itemTypes.has(item.type)) errors.push(`configuration.data[${index}].type is invalid`);
            });
          }
        }
        if (manifest.permissions !== void 0) {
          if (!isObject(manifest.permissions)) {
            errors.push("permissions must be an object");
          } else {
            const booleanKeys = [
              "node",
              "allowSystemRPC",
              "allowRoutes",
              "allowHooks",
              "allowHTMLInject",
              "allowExec",
              "allowListen",
              "allowAllFileAccess"
            ];
            for (const key of booleanKeys) {
              if (manifest.permissions[key] !== void 0 && typeof manifest.permissions[key] !== "boolean") {
                errors.push(`permissions.${key} must be a boolean`);
              }
            }
            for (const key of ["maxHTTPBodyBytes", "maxChildOutputBytes", "timeout"]) {
              if (manifest.permissions[key] !== void 0 && (!Number.isInteger(manifest.permissions[key]) || manifest.permissions[key] < 0)) {
                errors.push(`permissions.${key} must be a non-negative integer`);
              }
            }
          }
        }
        if (manifest.pages !== void 0) {
          if (!Array.isArray(manifest.pages)) {
            errors.push("pages must be an array");
          } else {
            manifest.pages.forEach((page, index) => {
              const prefix = `pages[${index}]`;
              if (!isObject(page)) {
                errors.push(`${prefix} must be an object`);
                return;
              }
              if (!hasText(page.title)) errors.push(`${prefix}.title is required`);
              const type = page.type || "iframe";
              const visibility = page.visibility || "admin";
              if (type !== "iframe" && type !== "redirect") errors.push(`${prefix}.type must be iframe or redirect`);
              if (visibility !== "admin" && visibility !== "public") errors.push(`${prefix}.visibility must be admin or public`);
              if (page.icon && !isLocalPath(page.icon)) errors.push(`${prefix}.icon must be a relative path`);
              if (type === "iframe" && !isLocalPath(page.file)) errors.push(`${prefix}.file must be a relative path`);
              if (type === "redirect" && !isSafeInternalPath(page.url)) errors.push(`${prefix}.url must be a safe internal path`);
            });
          }
        }
        return errors;
      }
      function isSafeInternalPath(value) {
        if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
        if (value.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
        return !value.split("/").includes("..");
      }
      function assertValidManifest(manifest) {
        const errors = validateManifest(manifest);
        if (errors.length > 0) throw new Error(errors.join("; "));
        return manifest;
      }
      module.exports = { assertValidManifest, validateManifest };
    }
  });

  // node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/rpc.js
  var require_rpc = __commonJS({
    "node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/rpc.js"(exports, module) {
      "use strict";
      function createRpcClient(getServer) {
        const methods = (includeInternal = false) => getServer().call("rpc.methods", { internal: includeInternal });
        return {
          call(method, ...params) {
            return getServer().call(method, ...params);
          },
          methods,
          has(method) {
            return methods(true).then((registered) => registered.includes(method));
          },
          help(method) {
            return getServer().call("rpc.help", { method });
          }
        };
      }
      module.exports = { createRpcClient };
    }
  });

  // node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/schema/komari-plugin.schema.json
  var require_komari_plugin_schema = __commonJS({
    "node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/schema/komari-plugin.schema.json"(exports, module) {
      module.exports = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://komari-monitor.github.io/plugin-sdk/komari-plugin.schema.json",
        title: "Komari Plugin Manifest",
        description: "Komari plugin manifest.",
        type: "object",
        required: ["name", "short"],
        properties: {
          $schema: { type: "string", description: "Schema URL used for editor validation." },
          name: { $ref: "#/$defs/localizedText", description: "Display name shown in Komari." },
          short: { type: "string", pattern: "^(?!default$)[A-Za-z0-9_-]+$", description: "Stable plugin identifier used in routes and RPC names." },
          description: { $ref: "#/$defs/localizedText", description: "Human-readable plugin description." },
          author: { $ref: "#/$defs/localizedText", description: "Plugin author or organization." },
          version: { type: "string", description: "Plugin version." },
          url: { type: "string", format: "uri", description: "Project or documentation URL." },
          icon: { type: "string", description: "Icon URL or plugin-relative icon path." },
          komari: { type: "string", description: "Compatible Komari version constraint, such as `>=1.4.0`." },
          entry: { type: "string", default: "script.js", description: "Compiled plugin entry file, relative to the package root." },
          permissions: { $ref: "#/$defs/permissions", description: "Runtime permissions requested by the plugin." },
          configuration: {
            type: "object",
            required: ["type", "data"],
            properties: {
              type: { const: "managed", description: "Use Komari-managed configuration storage." },
              data: { type: "array", items: { $ref: "#/$defs/configurationItem" }, description: "Configuration items shown in the admin UI." }
            },
            additionalProperties: false,
            description: "Optional configuration schema rendered by Komari."
          },
          pages: { type: "array", items: { $ref: "#/$defs/page" }, description: "Admin or public pages contributed by the plugin." }
        },
        additionalProperties: false,
        $defs: {
          localizedText: {
            description: "A string or a language-to-string map.",
            oneOf: [
              { type: "string", minLength: 1 },
              { type: "object", minProperties: 1, additionalProperties: { type: "string" } }
            ]
          },
          permissions: {
            description: "Capabilities that must be approved before enabling the plugin.",
            type: "object",
            properties: {
              node: { type: "boolean", description: "Enable Node.js-compatible modules." },
              allowSystemRPC: { type: "boolean", description: "Allow calls to system RPC methods." },
              allowRoutes: { type: "boolean", description: "Allow HTTP routes and static files." },
              allowHooks: { type: "boolean", description: "Allow request and response hooks." },
              allowHTMLInject: { type: "boolean", description: "Allow HTML head/body injection." },
              allowExec: { type: "boolean", description: "Allow child process execution." },
              allowListen: { type: "boolean", description: "Allow the plugin to listen on a local port." },
              allowAllFileAccess: { type: "boolean", description: "Allow file access outside the plugin directory." },
              maxHTTPBodyBytes: { type: "integer", minimum: 0, description: "Maximum request body size in bytes." },
              maxChildOutputBytes: { type: "integer", minimum: 0, description: "Maximum captured child process output in bytes." },
              timeout: { type: "integer", minimum: 0, description: "Plugin execution timeout in seconds." }
            },
            additionalProperties: false
          },
          page: {
            description: "A page exposed by the plugin.",
            type: "object",
            required: ["title"],
            properties: {
              file: { type: "string", description: "Page file relative to the plugin package." },
              title: { $ref: "#/$defs/localizedText", description: "Page title shown in navigation." },
              icon: { type: "string", description: "Page icon name or URL." },
              type: { enum: ["iframe", "redirect"], description: "Page presentation mode." },
              url: { type: "string", description: "Target URL for redirect pages." },
              visibility: { enum: ["admin", "public"], description: "Whether the page is visible to admins or the public." }
            },
            additionalProperties: false
          },
          configurationItem: {
            description: "One managed configuration field.",
            type: "object",
            required: ["name", "type"],
            properties: {
              key: { type: "string", minLength: 1, description: "Stable configuration key." },
              name: { $ref: "#/$defs/localizedText", description: "Label shown in the configuration UI." },
              type: { enum: ["string", "number", "select", "switch", "title", "textbox", "richtext", "nodes", "pingtasks"], description: "Editor control type." },
              options: { type: "string", description: "Options for select controls." },
              default: { description: "Default value." },
              required: { type: "boolean", description: "Whether a value is required." },
              help: { $ref: "#/$defs/localizedText", description: "Help text shown below the field." }
            },
            allOf: [
              {
                if: { properties: { type: { enum: ["title", "textbox"] } } },
                then: {},
                else: { required: ["key"] }
              }
            ],
            additionalProperties: false
          }
        }
      };
    }
  });

  // node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/rpc-catalog.json
  var require_rpc_catalog = __commonJS({
    "node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/rpc-catalog.json"(exports, module) {
      module.exports = {
        komari: "1.4.x",
        "rpc.methods": { params: "{ internal?: boolean }", returns: "string[]" },
        "rpc.version": { params: "none", returns: "string" },
        "rpc.ping": { params: "none", returns: "string ('pong')" },
        "rpc.help": { params: "{ method?: string }", returns: "MethodMeta | MethodMeta[]" },
        "common:getNodes": { params: "{ uuid?: string }", returns: "Client | Record<string, Client>" },
        "common:getNodesLatestStatus": { params: "{ uuid?: string, uuids?: string[] }", returns: "Record<string, unknown>" },
        "common:getMe": { params: "none", returns: "CurrentUser" },
        "common:getPublicInfo": { params: "none", returns: "PublicInfo" },
        "common:getVersion": { params: "none", returns: "{ version: string, hash: string }" },
        "common:getNodeRecentStatus": { params: "{ uuid: string }", returns: "{ count: number, records: unknown[] }" },
        "common:getRecords": { params: "RecordQuery", returns: "RecordQueryResponse" },
        "public:getMe": { params: "none", returns: "CurrentUser" },
        "public:getNodesInformation": { params: "none", returns: "Client[]" },
        "public:getPublicSettings": { params: "none", returns: "PublicInfo" },
        "public:getVersion": { params: "none", returns: "{ version: string, hash: string }" },
        "public:getClientRecentRecords": { params: "{ uuid: string }", returns: "unknown" },
        "public:getRecordsByUUID": { params: "{ uuid: string, load_type?: string, hours?: string }", returns: "{ records: unknown[], count: number }" },
        "public:getPingRecords": { params: "{ uuid?: string, task_id?: string | number }", returns: "{ records: unknown[], count: number }" },
        "public:getPublicPingTasks": { params: "none", returns: "PingTask[]" },
        "public:recordVisitorEvent": { params: "{ event: string, action?: string, path?: string, route?: string, target?: string, detail?: object }", returns: "{ status: string }" },
        "public:listMetricDefinitions": { params: "none", returns: "MetricDefinition[]" },
        "public:queryMetrics": { params: "MetricQuery", returns: "MetricSeriesResponse" },
        "public:getPingMetricStats": { params: "PingMetricStatsQuery", returns: "PingMetricStatsResponse" },
        "admin:addClient": { params: "{ name?: string }", returns: "{ uuid: string, token: string }" },
        "admin:editClient": { params: "{ uuid: string, ...fields }", returns: "null" },
        "admin:removeClient": { params: "{ uuid: string }", returns: "null" },
        "admin:getClient": { params: "{ uuid: string }", returns: "Client" },
        "admin:listClients": { params: "none", returns: "Client[]" },
        "admin:getClientToken": { params: "{ uuid: string }", returns: "{ token: string }" },
        "admin:clearRecords": { params: "none", returns: "null" },
        "admin:getTasks": { params: "none", returns: "ExecTask[]" },
        "admin:getTaskById": { params: "{ task_id: string }", returns: "ExecTask" },
        "admin:getTasksByClientId": { params: "{ uuid: string }", returns: "ExecTask[]" },
        "admin:getSpecificTaskResult": { params: "{ task_id: string, uuid: string }", returns: "TaskResult" },
        "admin:getTaskResultsByTaskId": { params: "{ task_id: string }", returns: "TaskResult[]" },
        "admin:exec": { params: "{ command: string, clients: string[] }", returns: "{ task_id: string, clients: string[], queued_clients: string[] }" },
        "admin:addPingTask": { params: "AddPingTaskParams", returns: "{ task_id: number }" },
        "admin:deletePingTask": { params: "{ id: number[] }", returns: "null" },
        "admin:editPingTask": { params: "{ tasks: PingTask[] }", returns: "null" },
        "admin:getAllPingTasks": { params: "none", returns: "PingTask[]" },
        "admin:orderPingTask": { params: "Record<string, number>", returns: "null" },
        "admin:addLoadNotification": { params: "AddLoadNotificationParams", returns: "{ task_id: number }" },
        "admin:deleteLoadNotification": { params: "{ id: number[] }", returns: "null" },
        "admin:editLoadNotification": { params: "{ notifications: LoadNotification[] }", returns: "null" },
        "admin:getAllLoadNotifications": { params: "none", returns: "LoadNotification[]" },
        "admin:listOfflineNotifications": { params: "none", returns: "OfflineNotification[]" },
        "admin:editOfflineNotification": { params: "OfflineNotification[]", returns: "null" },
        "admin:enableOfflineNotification": { params: "string[]", returns: "null" },
        "admin:disableOfflineNotification": { params: "string[]", returns: "null" },
        "admin:listTrafficReportNotifications": { params: "none", returns: "TrafficReportNotification[]" },
        "admin:editTrafficReportNotifications": { params: "TrafficReportNotification[]", returns: "null" },
        "admin:enableTrafficReportNotifications": { params: "string[]", returns: "null" },
        "admin:disableTrafficReportNotifications": { params: "string[]", returns: "null" },
        "admin:sendNotification": { params: "{ event: { event?: any, message?: any, emoji?: any, time?: string, clients?: { uuid: string }[] } }", returns: "null" },
        "admin:getSessions": { params: "none", returns: "{ current: string, data: Session[] }" },
        "admin:deleteSession": { params: "{ session: string }", returns: "null" },
        "admin:deleteAllSessions": { params: "none", returns: "null" },
        "admin:getSettings": { params: "none", returns: "object" },
        "admin:editSettings": { params: "Record<string, unknown>", returns: "null | { restart_required: true, guide_path: string }" },
        "admin:clearAllRecords": { params: "none", returns: "null" },
        "admin:orderClients": { params: "Record<string, number>", returns: "null" },
        "admin:getLogs": { params: "{ limit?: string, page?: string, msg_type?: string }", returns: "{ logs: Log[], total: number }" },
        "admin:testSendMessage": { params: "none", returns: "null" },
        "admin:testGeoip": { params: "{ ip?: string }", returns: "GeoInfo" },
        "admin:listPlugins": { params: "none", returns: "PluginStatus[]" },
        "admin:setPluginEnabled": { params: "{ short: string, enabled: boolean, approved?: boolean }", returns: "null | { requires_approval: true }" },
        "admin:getPluginLogs": { params: "{ short: string }", returns: "{ logs: string }" },
        "admin:deletePlugin": { params: "{ short: string }", returns: "null" },
        "admin:getPluginConfiguration": { params: "{ short: string }", returns: "{ configuration: object, data: object }" },
        "admin:setPluginConfiguration": { params: "{ short: string, data: object }", returns: "null" },
        "admin:getXtermjsSettings": { params: "none", returns: "XtermJSSettings" },
        "admin:setXtermjsSettings": { params: "XtermJSSettings", returns: "XtermJSSettings" },
        "admin:getMessageSenderProvider": { params: "{ provider?: string }", returns: "MessageSenderProvider | MessageSenderProvider[]" },
        "admin:setMessageSenderProvider": { params: "MessageSenderProvider", returns: "{ message: string }" },
        "admin:getOidcProvider": { params: "{ provider?: string }", returns: "OidcProvider | OidcProvider[]" },
        "admin:setOidcProvider": { params: "OidcProvider", returns: "{ message: string }" },
        "admin:getClipboard": { params: "{ id: string }", returns: "Clipboard" },
        "admin:listClipboard": { params: "none", returns: "Clipboard[]" },
        "admin:createClipboard": { params: "Clipboard", returns: "Clipboard" },
        "admin:updateClipboard": { params: "Clipboard", returns: "Clipboard" },
        "admin:deleteClipboard": { params: "{ id: string }", returns: "null" },
        "admin:batchDeleteClipboard": { params: "{ ids: string[] }", returns: "null" },
        "admin:getDatabaseSize": { params: "none", returns: "DatabaseStatus" },
        "admin:vacuumDatabase": { params: "none", returns: "DatabaseMaintenanceResponse" },
        "admin:dbQuery": { params: '{ database?: "main" | "metrics", sql: string, args?: any[], limit?: number }', returns: "DatabaseQueryResult" },
        "admin:dbExec": { params: '{ database?: "main" | "metrics", sql: string, args?: any[] }', returns: "DatabaseExecResult" },
        "admin:dbTables": { params: '{ database?: "main" | "metrics" }', returns: "DatabaseTablesResult" },
        "admin:listMetricDefinitions": { params: "none", returns: "MetricDefinition[]" },
        "admin:updateMetricDefinition": { params: "{ name: string, retention_days: number }", returns: "MetricDefinition" },
        "admin:getMetricMigrationStatus": { params: "none", returns: "MetricMigrationStatus" },
        "admin:startMetricMigration": { params: "{ source_driver?: string, source_dsn?: string }", returns: "{ status: string, message: string }" },
        "admin:cancelMetricMigration": { params: "none", returns: "{ status: string, message: string }" },
        "client:getPingTasks": { params: "none", returns: "PingTask[]" },
        "client:uploadPingResult": { params: "UploadPingResultParams", returns: "{ status: string }" },
        "client:taskResult": { params: "TaskResultParams", returns: "{ status: string, message: string }" }
      };
    }
  });

  // node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/index.js
  var require_src = __commonJS({
    "node_modules/.pnpm/@komari-monitor+plugin-sdk@1.4.3/node_modules/@komari-monitor/plugin-sdk/src/index.js"(exports, module) {
      "use strict";
      var { assertValidManifest, validateManifest } = require_manifest();
      var { createRpcClient } = require_rpc();
      var manifestSchema = require_komari_plugin_schema();
      var rpcCatalog = require_rpc_catalog();
      var cachedServer;
      function getServer() {
        if (!cachedServer) {
          cachedServer = __require("server");
        }
        return cachedServer;
      }
      function definePlugin2(definition) {
        if (!definition || typeof definition !== "object") {
          throw new TypeError("definePlugin requires a plugin definition object");
        }
        const load = typeof definition.load === "function" ? definition.load : () => {
        };
        const unload = typeof definition.unload === "function" ? definition.unload : () => {
        };
        globalThis.load = load;
        globalThis.unload = unload;
        return definition;
      }
      function jsonResponse(res, value, statusCode = 200) {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(value));
        return res;
      }
      function textResponse(res, value, statusCode = 200, contentType = "text/plain; charset=utf-8") {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", contentType);
        res.end(String(value));
        return res;
      }
      var exportsObject = {
        assertValidManifest,
        definePlugin: definePlugin2,
        jsonResponse,
        manifestSchema,
        rpc: createRpcClient(getServer),
        rpcCatalog,
        textResponse,
        validateManifest
      };
      Object.defineProperty(exportsObject, "server", {
        enumerable: true,
        get: getServer
      });
      module.exports = exportsObject;
    }
  });

  // src/plugin.ts
  var import_plugin_sdk2 = __toESM(require_src());

  // src/features/hostname/index.ts
  var import_plugin_sdk = __toESM(require_src());

  // src/shared/json-store.ts
  var fs = __require("fs");
  var path = __require("path");
  var JsonStore = class {
    constructor(directory, fileName, normalize) {
      this.normalize = normalize;
      fs.mkdirSync(directory, { recursive: true, mode: 448 });
      this.filePath = path.join(directory, fileName);
      this.temporaryPath = `${this.filePath}.tmp`;
    }
    read() {
      for (const candidate of [this.filePath, this.temporaryPath]) {
        if (!fs.existsSync(candidate)) continue;
        try {
          return this.normalize(JSON.parse(fs.readFileSync(candidate, "utf8")));
        } catch (error) {
          console.warn(`[onani] ignored invalid cache file: ${error instanceof Error ? error.message : "parse failed"}`);
        }
      }
      return this.normalize(void 0);
    }
    write(value) {
      const serialized = `${JSON.stringify(value)}
`;
      fs.writeFileSync(this.temporaryPath, serialized, { encoding: "utf8", mode: 384 });
      try {
        fs.renameSync(this.temporaryPath, this.filePath);
      } catch (firstError) {
        try {
          if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
          fs.renameSync(this.temporaryPath, this.filePath);
        } catch {
          try {
            if (fs.existsSync(this.temporaryPath)) fs.unlinkSync(this.temporaryPath);
          } catch {
          }
          throw firstError;
        }
      }
    }
  };

  // src/shared/bounded-job-queue.ts
  var BoundedJobQueue = class {
    constructor(maxConcurrent, worker, onChange = () => void 0, onError = () => void 0) {
      this.maxConcurrent = maxConcurrent;
      this.worker = worker;
      this.onChange = onChange;
      this.onError = onError;
      this.pendingItems = [];
      this.activeItems = 0;
      if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error("maxConcurrent must be a positive integer");
      }
    }
    get activeCount() {
      return this.activeItems;
    }
    get pendingCount() {
      return this.pendingItems.length;
    }
    get size() {
      return this.activeItems + this.pendingItems.length;
    }
    enqueue(item) {
      this.pendingItems.push(item);
      this.pump();
    }
    snapshot() {
      return {
        active: this.activeItems,
        pending: this.pendingItems.length,
        total: this.size
      };
    }
    pump() {
      let changed = false;
      while (this.activeItems < this.maxConcurrent && this.pendingItems.length > 0) {
        const item = this.pendingItems.shift();
        if (item === void 0) break;
        this.activeItems += 1;
        changed = true;
        void Promise.resolve().then(() => this.worker(item)).catch((error) => this.onError(error, item)).finally(() => {
          this.activeItems -= 1;
          this.pump();
          this.emit();
        });
      }
      if (changed) this.emit();
    }
    emit() {
      this.onChange(this.snapshot());
    }
  };

  // src/shared/async-timeout.ts
  var OperationTimeoutError = class extends Error {
    constructor(message) {
      super(message);
      this.code = "ONANI_OPERATION_TIMEOUT";
      this.name = "OperationTimeoutError";
    }
  };
  function withTimeout(promise, timeoutMs, message) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new OperationTimeoutError(message));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new OperationTimeoutError(message)));
      }, timeoutMs);
      promise.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      );
    });
  }
  function isOperationTimeout(error) {
    return error instanceof OperationTimeoutError || typeof error === "object" && error !== null && "code" in error && error.code === "ONANI_OPERATION_TIMEOUT";
  }

  // src/features/hostname/core.ts
  var HOSTNAME_CACHE_SCHEMA = 1;
  var DEFAULT_CACHE_DAYS = 30;
  var MIN_CACHE_DAYS = 1;
  var MAX_CACHE_DAYS = 3650;
  var RETRY_BACKOFF_MS = 24 * 60 * 60 * 1e3;
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var FORBIDDEN_HOSTNAME_CHARACTER = /[\s/\\:<>"'`]/u;
  function asBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }
  function asCacheDays(value) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_CACHE_DAYS;
    const days = Math.trunc(numeric);
    if (days < MIN_CACHE_DAYS || days > MAX_CACHE_DAYS) {
      return DEFAULT_CACHE_DAYS;
    }
    return days;
  }
  function resolveHostnameConfig(input) {
    const cacheDays = asCacheDays(input.hostname_cache_days);
    return {
      enabled: asBoolean(input.hostname_enabled, true),
      autoRefresh: asBoolean(input.hostname_auto_refresh, true),
      cacheDays,
      cacheTtlMs: cacheDays * 24 * 60 * 60 * 1e3
    };
  }
  function isUuid(value) {
    return typeof value === "string" && UUID_PATTERN.test(value);
  }
  function normalizeUuidList(value, limit = 500) {
    if (!Array.isArray(value)) return [];
    const unique = /* @__PURE__ */ new Set();
    for (const item of value) {
      if (!isUuid(item)) continue;
      unique.add(item.toLowerCase());
      if (unique.size >= limit) break;
    }
    return [...unique];
  }
  function validIsoTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }
  function normalizeCacheEntry(value) {
    if (!isRecord(value)) return null;
    const entry = {};
    const normalizedHostname = normalizeHostname(value.hostname);
    if (normalizedHostname.ok) {
      entry.hostname = normalizedHostname.hostname;
    }
    if (validIsoTimestamp(value.collected_at)) entry.collected_at = value.collected_at;
    if (validIsoTimestamp(value.last_attempt_at)) entry.last_attempt_at = value.last_attempt_at;
    if (typeof value.last_error === "string" && value.last_error.trim()) {
      entry.last_error = safeErrorText(value.last_error);
    }
    return entry;
  }
  function emptyHostnameCache() {
    return {
      schema: HOSTNAME_CACHE_SCHEMA,
      updated_at: null,
      entries: /* @__PURE__ */ Object.create(null)
    };
  }
  function normalizeHostnameCache(value) {
    const cache = emptyHostnameCache();
    if (!isRecord(value) || value.schema !== HOSTNAME_CACHE_SCHEMA || !isRecord(value.entries)) {
      return cache;
    }
    if (validIsoTimestamp(value.updated_at)) cache.updated_at = value.updated_at;
    for (const [uuid, candidate] of Object.entries(value.entries)) {
      if (!isUuid(uuid)) continue;
      const entry = normalizeCacheEntry(candidate);
      if (entry) cache.entries[uuid.toLowerCase()] = entry;
    }
    return cache;
  }
  function shouldRefreshHostname(entry, nowMs, cacheTtlMs, retryBackoffMs = RETRY_BACKOFF_MS) {
    if (entry?.hostname && entry.collected_at) {
      const collectedAt = Date.parse(entry.collected_at);
      if (Number.isFinite(collectedAt) && nowMs - collectedAt < cacheTtlMs) {
        return false;
      }
    }
    if (entry?.last_attempt_at) {
      const lastAttemptAt = Date.parse(entry.last_attempt_at);
      if (Number.isFinite(lastAttemptAt) && nowMs - lastAttemptAt < retryBackoffMs) {
        return false;
      }
    }
    return true;
  }
  function normalizeHostname(output) {
    if (typeof output !== "string") {
      return { ok: false, error: "Agent \u672A\u8FD4\u56DE\u6587\u672C\u7ED3\u679C" };
    }
    const lines = output.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1) {
      return { ok: false, error: lines.length === 0 ? "Agent \u8FD4\u56DE\u4E86\u7A7A\u4E3B\u673A\u540D" : "Agent \u8FD4\u56DE\u4E86\u591A\u884C\u7ED3\u679C" };
    }
    const hostname = lines[0];
    if (hostname.length > 253) {
      return { ok: false, error: "\u4E3B\u673A\u540D\u8D85\u8FC7 253 \u4E2A\u5B57\u7B26" };
    }
    for (const character of hostname) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint < 33 || codePoint === 127 || FORBIDDEN_HOSTNAME_CHARACTER.test(character)) {
        return { ok: false, error: "\u4E3B\u673A\u540D\u5305\u542B\u4E0D\u5B89\u5168\u5B57\u7B26" };
      }
    }
    return { ok: true, hostname };
  }
  function safeErrorText(value, fallback = "\u672A\u77E5\u9519\u8BEF") {
    const text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
    const compact = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return (compact || fallback).slice(0, 180);
  }
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // src/features/hostname/index.ts
  var STATUS_RPC = "plugin:onani.hostname.status";
  var REFRESH_RPC = "plugin:onani.hostname.refresh";
  var HOSTNAME_COMMAND = "hostname";
  var AUTO_SCAN_EXPRESSION = "@every 6h";
  var STARTUP_SCAN_DELAY_MS = 2e4;
  var RESULT_POLL_INTERVAL_MS = 1e3;
  var CONFIG_RPC_TIMEOUT_MS = 5e3;
  var LOCAL_RPC_TIMEOUT_MS = 5e3;
  var EXEC_RPC_TIMEOUT_MS = 7e3;
  var RESULT_RPC_TIMEOUT_MS = 5e3;
  var RESULT_POLL_TIMEOUT_MS = 2e4;
  var REFRESH_JOB_TIMEOUT_MS = 3e4;
  var MAX_CONCURRENT_REFRESH_JOBS = 4;
  var RPC_NOT_FOUND = -32044;
  var DEFAULT_CONFIG = resolveHostnameConfig({});
  function newRefreshState() {
    return {
      running: false,
      reason: null,
      started_at: null,
      finished_at: null,
      requested: 0,
      targeted: 0,
      succeeded: 0,
      failed: 0,
      skipped_offline: 0,
      skipped_fresh: 0,
      skipped_busy: 0,
      message: "\u5C1A\u672A\u6267\u884C\u91C7\u96C6"
    };
  }
  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  function nodeMapFrom(value) {
    const nodes = /* @__PURE__ */ new Map();
    if (!isRecord(value)) return nodes;
    for (const [key, rawNode] of Object.entries(value)) {
      if (!isRecord(rawNode)) continue;
      const uuidCandidate = isUuid(rawNode.uuid) ? rawNode.uuid : key;
      if (!isUuid(uuidCandidate)) continue;
      nodes.set(uuidCandidate.toLowerCase(), {
        uuid: uuidCandidate.toLowerCase(),
        name: typeof rawNode.name === "string" ? rawNode.name : void 0,
        weight: typeof rawNode.weight === "number" ? rawNode.weight : void 0
      });
    }
    return nodes;
  }
  function onlineSetFrom(value) {
    const online = /* @__PURE__ */ new Set();
    if (!isRecord(value)) return online;
    for (const [uuid, rawStatus] of Object.entries(value)) {
      if (isUuid(uuid) && isRecord(rawStatus) && rawStatus.online === true) {
        online.add(uuid.toLowerCase());
      }
    }
    return online;
  }
  function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && isUuid(item)).map((item) => item.toLowerCase()) : [];
  }
  function rpcErrorCode(error) {
    if (!isRecord(error) || typeof error.code !== "number" || !Number.isInteger(error.code)) return null;
    return error.code;
  }
  var HostnameFeature = class {
    constructor() {
      this.store = new JsonStore(
        __storageDir__,
        "hostname-cache.json",
        normalizeHostnameCache
      );
      this.cache = emptyHostnameCache();
      this.config = DEFAULT_CONFIG;
      this.refresh = newRefreshState();
      this.queuedUuids = /* @__PURE__ */ new Set();
      this.activeUuids = /* @__PURE__ */ new Set();
      this.bulkJobs = 0;
      this.waveMessage = null;
      this.waveError = null;
      this.jobs = new BoundedJobQueue(
        MAX_CONCURRENT_REFRESH_JOBS,
        (job) => this.processRefreshJob(job),
        () => this.syncRefreshState(),
        (error) => console.error(`[onani] hostname queue failed: ${safeErrorText(error)}`)
      );
    }
    load() {
      this.cache = this.store.read();
      import_plugin_sdk.server.registerRPC(STATUS_RPC, () => this.status());
      import_plugin_sdk.server.registerRPC(REFRESH_RPC, (params) => this.requestManualRefresh(params));
      import_plugin_sdk.server.cron(AUTO_SCAN_EXPRESSION, () => this.requestRefresh({ reason: "scheduled", force: false }));
      void this.reloadConfig().catch((error) => {
        console.error(`[onani] failed to load hostname configuration: ${safeErrorText(error)}`);
      });
      setTimeout(() => {
        this.requestRefresh({ reason: "startup", force: false });
      }, STARTUP_SCAN_DELAY_MS);
    }
    status() {
      return {
        feature: "hostname",
        cache_schema: this.cache.schema,
        cache_updated_at: this.cache.updated_at,
        config: {
          enabled: this.config.enabled,
          auto_refresh: this.config.autoRefresh,
          cache_days: this.config.cacheDays,
          scan_interval_hours: 6,
          failure_retry_hours: 24
        },
        refresh: this.refreshSnapshot(),
        entries: { ...this.cache.entries }
      };
    }
    requestManualRefresh(params) {
      const input = isRecord(params) ? params : {};
      const suppliedUuids = Object.prototype.hasOwnProperty.call(input, "uuids");
      const uuids = normalizeUuidList(input.uuids);
      if (suppliedUuids && uuids.length === 0) {
        return this.refreshResponse(false, "\u6CA1\u6709\u6709\u6548\u7684\u8282\u70B9 UUID");
      }
      return this.requestRefresh({
        reason: "manual",
        force: input.force === true,
        uuids: suppliedUuids ? uuids : void 0
      });
    }
    requestRefresh(request) {
      const bulk = request.uuids === void 0;
      if (bulk && this.bulkJobs > 0) {
        return this.refreshResponse(false, "\u6279\u91CF\u5237\u65B0\u5DF2\u5728\u8FD0\u884C\u6216\u6392\u961F\u4E2D");
      }
      const requestedUuids = request.uuids ?? [];
      const availableUuids = requestedUuids.filter(
        (uuid) => !this.activeUuids.has(uuid) && !this.queuedUuids.has(uuid)
      );
      if (!bulk && availableUuids.length === 0) {
        return this.refreshResponse(false, "\u6240\u9009\u8282\u70B9\u5DF2\u5728\u5237\u65B0\u6216\u6392\u961F\u4E2D");
      }
      if (!this.refresh.running && this.jobs.size === 0) {
        this.refresh = {
          ...newRefreshState(),
          running: true,
          reason: request.reason,
          started_at: (/* @__PURE__ */ new Date()).toISOString(),
          message: "\u6B63\u5728\u68C0\u67E5\u8282\u70B9\u548C\u7F13\u5B58"
        };
        this.waveMessage = null;
        this.waveError = null;
      } else if (request.reason === "manual") {
        this.refresh.reason = "manual";
      }
      const reservedUuids = new Set(availableUuids);
      for (const uuid of reservedUuids) this.queuedUuids.add(uuid);
      if (bulk) this.bulkJobs += 1;
      const job = {
        request: { ...request, uuids: bulk ? void 0 : availableUuids },
        reservedUuids,
        activeUuids: /* @__PURE__ */ new Set(),
        bulk,
        deadlineAt: Date.now() + REFRESH_JOB_TIMEOUT_MS
      };
      this.jobs.enqueue(job);
      this.syncRefreshState();
      const skipped = requestedUuids.length - availableUuids.length;
      const message = skipped > 0 ? `\u5237\u65B0\u4EFB\u52A1\u5DF2\u52A0\u5165\u961F\u5217\uFF0C\u5DF2\u8DF3\u8FC7 ${skipped} \u4E2A\u91CD\u590D\u8282\u70B9` : "\u5237\u65B0\u4EFB\u52A1\u5DF2\u52A0\u5165\u961F\u5217";
      return this.refreshResponse(true, message);
    }
    refreshSnapshot() {
      return {
        ...this.refresh,
        active_uuids: [...this.activeUuids].sort(),
        queued_uuids: [...this.queuedUuids].sort(),
        active_jobs: this.jobs.activeCount,
        queued_jobs: this.jobs.pendingCount,
        bulk_running: this.bulkJobs > 0,
        max_concurrent_jobs: MAX_CONCURRENT_REFRESH_JOBS,
        result_timeout_seconds: RESULT_POLL_TIMEOUT_MS / 1e3,
        job_timeout_seconds: REFRESH_JOB_TIMEOUT_MS / 1e3
      };
    }
    refreshResponse(accepted, message) {
      return { accepted, ...this.refreshSnapshot(), message };
    }
    syncRefreshState() {
      const wasRunning = this.refresh.running;
      const running = this.jobs.size > 0;
      this.refresh.running = running;
      if (running) {
        const active = this.activeUuids.size;
        const queued = this.queuedUuids.size;
        if (active > 0 && queued > 0) {
          this.refresh.message = `\u6B63\u5728\u5237\u65B0 ${active} \u4E2A\u8282\u70B9\uFF0C\u53E6\u6709 ${queued} \u4E2A\u6392\u961F\u4E2D`;
        } else if (active > 0) {
          this.refresh.message = `\u6B63\u5728\u5237\u65B0 ${active} \u4E2A\u8282\u70B9`;
        } else if (queued > 0) {
          this.refresh.message = `${queued} \u4E2A\u8282\u70B9\u6B63\u5728\u7B49\u5F85\u5237\u65B0`;
        } else {
          this.refresh.message = "\u6B63\u5728\u68C0\u67E5\u8282\u70B9\u548C\u7F13\u5B58";
        }
        return;
      }
      if (!wasRunning) return;
      this.refresh.finished_at = (/* @__PURE__ */ new Date()).toISOString();
      if (this.refresh.targeted === 0 && this.waveError) {
        this.refresh.message = this.waveError;
      } else if (this.refresh.targeted === 0 && this.waveMessage) {
        this.refresh.message = this.waveMessage;
      } else {
        const summary = this.refresh.failed > 0 ? `\u5237\u65B0\u5B8C\u6210\uFF1A\u6210\u529F ${this.refresh.succeeded}\uFF0C\u5931\u8D25 ${this.refresh.failed}` : `\u5237\u65B0\u5B8C\u6210\uFF1A\u6210\u529F ${this.refresh.succeeded}`;
        this.refresh.message = this.waveError ? `${summary}\uFF1B${this.waveError}` : summary;
      }
    }
    async processRefreshJob(job) {
      try {
        await this.runRefresh(job);
      } catch (error) {
        const message = safeErrorText(error, "\u4E3B\u673A\u540D\u5237\u65B0\u5931\u8D25");
        this.waveError = message;
        const affected = [.../* @__PURE__ */ new Set([...job.activeUuids, ...job.reservedUuids])];
        if (affected.length > 0) {
          this.markFailed(affected, message);
          this.persistCache();
        }
        console.error(`[onani] hostname refresh failed: ${message}`);
      } finally {
        for (const uuid of job.reservedUuids) this.queuedUuids.delete(uuid);
        for (const uuid of job.activeUuids) this.activeUuids.delete(uuid);
        job.activeUuids.clear();
        if (job.bulk) this.bulkJobs = Math.max(0, this.bulkJobs - 1);
        this.syncRefreshState();
      }
    }
    callWithJobTimeout(job, operation, stageTimeoutMs, call) {
      const remaining = job.deadlineAt - Date.now();
      if (remaining <= 0) {
        return Promise.reject(new OperationTimeoutError(
          `\u5237\u65B0\u4F5C\u4E1A\u8D85\u8FC7 ${REFRESH_JOB_TIMEOUT_MS / 1e3} \u79D2\u603B\u65F6\u9650\uFF0C\u5DF2\u81EA\u52A8\u53D6\u6D88`
        ));
      }
      const timeoutMs = Math.min(stageTimeoutMs, remaining);
      const message = remaining <= stageTimeoutMs ? `\u5237\u65B0\u4F5C\u4E1A\u8D85\u8FC7 ${REFRESH_JOB_TIMEOUT_MS / 1e3} \u79D2\u603B\u65F6\u9650\uFF0C\u5DF2\u81EA\u52A8\u53D6\u6D88` : `${operation}\u8D85\u65F6\uFF08${stageTimeoutMs / 1e3} \u79D2\uFF09`;
      return withTimeout(call(), timeoutMs, message);
    }
    async reloadConfig(job) {
      const raw = job ? await this.callWithJobTimeout(
        job,
        "\u8BFB\u53D6\u63D2\u4EF6\u914D\u7F6E",
        CONFIG_RPC_TIMEOUT_MS,
        () => import_plugin_sdk.server.getConfig()
      ) : await withTimeout(
        import_plugin_sdk.server.getConfig(),
        CONFIG_RPC_TIMEOUT_MS,
        `\u8BFB\u53D6\u63D2\u4EF6\u914D\u7F6E\u8D85\u65F6\uFF08${CONFIG_RPC_TIMEOUT_MS / 1e3} \u79D2\uFF09`
      );
      this.config = resolveHostnameConfig(raw);
      return this.config;
    }
    async runRefresh(job) {
      const request = job.request;
      const config = await this.reloadConfig(job);
      if (!config.enabled) {
        this.waveMessage = "\u4E3B\u673A\u540D\u91C7\u96C6\u529F\u80FD\u5DF2\u5173\u95ED";
        return;
      }
      if (request.reason !== "manual" && !config.autoRefresh) {
        this.waveMessage = "\u81EA\u52A8\u5237\u65B0\u5DF2\u5173\u95ED";
        return;
      }
      const [rawNodes, rawStatuses] = await Promise.all([
        this.callWithJobTimeout(
          job,
          "\u8BFB\u53D6\u8282\u70B9\u5217\u8868",
          LOCAL_RPC_TIMEOUT_MS,
          () => import_plugin_sdk.server.call("common:getNodes")
        ),
        this.callWithJobTimeout(
          job,
          "\u8BFB\u53D6\u8282\u70B9\u72B6\u6001",
          LOCAL_RPC_TIMEOUT_MS,
          () => import_plugin_sdk.server.call("common:getNodesLatestStatus")
        )
      ]);
      const nodes = nodeMapFrom(rawNodes);
      const online = onlineSetFrom(rawStatuses);
      this.pruneDeletedNodes(new Set(nodes.keys()));
      const requested = request.uuids ?? [...nodes.keys()];
      this.refresh.requested += requested.length;
      const now = Date.now();
      const targets = [];
      for (const uuid of requested) {
        if (!nodes.has(uuid)) continue;
        const reservedByAnotherJob = this.queuedUuids.has(uuid) && !job.reservedUuids.has(uuid);
        if (this.activeUuids.has(uuid) || reservedByAnotherJob) {
          this.refresh.skipped_busy += 1;
          continue;
        }
        if (!online.has(uuid)) {
          this.refresh.skipped_offline += 1;
          continue;
        }
        if (!request.force && !shouldRefreshHostname(this.cache.entries[uuid], now, config.cacheTtlMs)) {
          this.refresh.skipped_fresh += 1;
          continue;
        }
        targets.push(uuid);
      }
      this.refresh.targeted += targets.length;
      for (const uuid of targets) {
        this.activeUuids.add(uuid);
        job.activeUuids.add(uuid);
      }
      for (const uuid of job.reservedUuids) this.queuedUuids.delete(uuid);
      job.reservedUuids.clear();
      this.syncRefreshState();
      if (targets.length === 0) {
        this.waveMessage = "\u6CA1\u6709\u9700\u8981\u5237\u65B0\u7684\u5728\u7EBF\u8282\u70B9";
        return;
      }
      const attemptedAt = (/* @__PURE__ */ new Date()).toISOString();
      for (const uuid of targets) {
        const previous = this.cache.entries[uuid] ?? {};
        this.cache.entries[uuid] = { ...previous, last_attempt_at: attemptedAt, last_error: void 0 };
      }
      this.persistCache();
      let execResponse;
      try {
        execResponse = await this.callWithJobTimeout(
          job,
          "\u4E0B\u53D1 hostname \u547D\u4EE4",
          EXEC_RPC_TIMEOUT_MS,
          () => import_plugin_sdk.server.call("admin:exec", {
            command: HOSTNAME_COMMAND,
            clients: targets
          })
        );
      } catch (error) {
        const message = `\u65E0\u6CD5\u4E0B\u53D1\u56FA\u5B9A hostname \u547D\u4EE4\uFF1A${safeErrorText(error)}`;
        this.markFailed(targets, message);
        this.releaseActive(job, targets);
        this.persistCache();
        return;
      }
      const taskId = typeof execResponse.task_id === "string" ? execResponse.task_id : "";
      if (!taskId) {
        this.markFailed(targets, "Komari \u672A\u8FD4\u56DE\u8FDC\u7A0B\u4EFB\u52A1 ID");
        this.releaseActive(job, targets);
        this.persistCache();
        return;
      }
      const targetSet = new Set(targets);
      const accepted = new Set(
        [...stringList(execResponse.clients), ...stringList(execResponse.queued_clients)].filter((uuid) => targetSet.has(uuid))
      );
      const rejected = targets.filter((uuid) => !accepted.has(uuid));
      if (rejected.length > 0) {
        this.markFailed(rejected, "\u8282\u70B9\u5728\u547D\u4EE4\u4E0B\u53D1\u524D\u5DF2\u79BB\u7EBF");
        this.releaseActive(job, rejected);
      }
      await this.collectTaskResults(job, taskId, [...accepted]);
      this.persistCache();
    }
    async collectTaskResults(job, taskId, targets) {
      const pending = new Set(targets);
      const resultDeadline = Math.min(job.deadlineAt, Date.now() + RESULT_POLL_TIMEOUT_MS);
      let consecutiveErrors = 0;
      while (pending.size > 0 && Date.now() < resultDeadline) {
        let results = [];
        try {
          const remaining2 = resultDeadline - Date.now();
          const timeoutMs = Math.min(RESULT_RPC_TIMEOUT_MS, remaining2);
          const deadlineMessage = job.deadlineAt <= resultDeadline ? `\u5237\u65B0\u4F5C\u4E1A\u8D85\u8FC7 ${REFRESH_JOB_TIMEOUT_MS / 1e3} \u79D2\u603B\u65F6\u9650\uFF0C\u5DF2\u81EA\u52A8\u53D6\u6D88` : `\u7B49\u5F85 Agent \u8FD4\u56DE\u4E3B\u673A\u540D\u8D85\u65F6\uFF08${RESULT_POLL_TIMEOUT_MS / 1e3} \u79D2\uFF09`;
          const message = remaining2 <= RESULT_RPC_TIMEOUT_MS ? deadlineMessage : `\u67E5\u8BE2\u8FDC\u7A0B\u4EFB\u52A1\u7ED3\u679C\u8D85\u65F6\uFF08${RESULT_RPC_TIMEOUT_MS / 1e3} \u79D2\uFF09`;
          const response = await withTimeout(
            import_plugin_sdk.server.call("admin:getTaskResultsByTaskId", { task_id: taskId }),
            timeoutMs,
            message
          );
          if (Array.isArray(response)) results = response;
          consecutiveErrors = 0;
        } catch (error) {
          if (isOperationTimeout(error)) throw error;
          if (rpcErrorCode(error) === RPC_NOT_FOUND) {
            consecutiveErrors = 0;
          } else {
            consecutiveErrors += 1;
            console.warn(`[onani] waiting for hostname task ${taskId}: ${safeErrorText(error)}`);
            if (consecutiveErrors >= 3) {
              throw new Error(`\u8FDE\u7EED 3 \u6B21\u8BFB\u53D6\u8FDC\u7A0B\u4EFB\u52A1\u7ED3\u679C\u5931\u8D25\uFF1A${safeErrorText(error)}`);
            }
          }
        }
        let changed = false;
        for (const result of results) {
          const uuid = typeof result.client === "string" ? result.client.toLowerCase() : "";
          if (!pending.has(uuid) || typeof result.exit_code !== "number") continue;
          pending.delete(uuid);
          changed = true;
          if (result.exit_code === 0) {
            const normalized = normalizeHostname(result.result);
            if (normalized.ok) {
              const previous = this.cache.entries[uuid] ?? {};
              this.cache.entries[uuid] = {
                ...previous,
                hostname: normalized.hostname,
                collected_at: (/* @__PURE__ */ new Date()).toISOString(),
                last_error: void 0
              };
              this.refresh.succeeded += 1;
            } else {
              this.markFailed([uuid], normalized.error);
            }
          } else {
            this.markFailed([uuid], safeErrorText(result.result, `Agent \u8FD4\u56DE\u9000\u51FA\u7801 ${result.exit_code}`));
          }
          this.releaseActive(job, [uuid]);
        }
        if (changed) this.persistCache();
        const remaining = resultDeadline - Date.now();
        if (pending.size > 0 && remaining > 0) {
          await sleep(Math.min(RESULT_POLL_INTERVAL_MS, remaining));
        }
      }
      if (pending.size > 0) {
        const message = job.deadlineAt <= resultDeadline ? `\u5237\u65B0\u4F5C\u4E1A\u8D85\u8FC7 ${REFRESH_JOB_TIMEOUT_MS / 1e3} \u79D2\u603B\u65F6\u9650\uFF0C\u5DF2\u81EA\u52A8\u53D6\u6D88` : `\u7B49\u5F85 Agent \u8FD4\u56DE\u4E3B\u673A\u540D\u8D85\u65F6\uFF08${RESULT_POLL_TIMEOUT_MS / 1e3} \u79D2\uFF09`;
        this.markFailed([...pending], message);
        this.releaseActive(job, [...pending]);
      }
    }
    releaseActive(job, uuids) {
      for (const uuid of uuids) {
        job.activeUuids.delete(uuid);
        this.activeUuids.delete(uuid);
      }
      this.syncRefreshState();
    }
    markFailed(uuids, message) {
      const safeMessage = safeErrorText(message);
      for (const uuid of uuids) {
        const previous = this.cache.entries[uuid] ?? {};
        this.cache.entries[uuid] = { ...previous, last_error: safeMessage };
        this.refresh.failed += 1;
      }
    }
    pruneDeletedNodes(currentUuids) {
      let changed = false;
      for (const uuid of Object.keys(this.cache.entries)) {
        if (currentUuids.has(uuid)) continue;
        delete this.cache.entries[uuid];
        changed = true;
      }
      if (changed) this.persistCache();
    }
    persistCache() {
      this.cache.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      this.store.write(this.cache);
    }
  };
  function registerHostnameFeature() {
    new HostnameFeature().load();
  }

  // src/plugin.ts
  (0, import_plugin_sdk2.definePlugin)({
    load() {
      registerHostnameFeature();
    }
  });
})();
