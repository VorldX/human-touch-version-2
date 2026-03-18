export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireOrgAccess } from "@/lib/security/org-access";

interface BoolRow {
  exists: boolean;
}

interface TierCountRow {
  longTerm: number;
  archive: number;
  staging: number;
  contextual: number;
  working: number;
}

interface GraphCountRow {
  nodes: number;
  edges: number;
}

interface GuardRailRow {
  centralMemoryRls: boolean;
  nodesRls: boolean;
  edgesRls: boolean;
  centralMemoryVersion: boolean;
  nodesVersion: boolean;
  edgesVersion: boolean;
  centralMemorySchemaVersion: boolean;
  nodesSchemaVersion: boolean;
  edgesSchemaVersion: boolean;
}

interface PartitionRow {
  parent: "central_memory" | "nodes" | "edges";
  child: string;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSchemaMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "";

  return (
    code === "42P01" ||
    /relation\s+.*does not exist/i.test(message) ||
    /schema\s+"?dna_memory"?\s+does not exist/i.test(message)
  );
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim();
  const userId = access.actor.isInternal
    ? requestedUserId || access.actor.userId
    : access.actor.userId;

  try {
    const schemaRows = await prisma.$queryRawUnsafe<BoolRow[]>(
      "SELECT to_regclass('dna_memory.central_memory') IS NOT NULL AS exists"
    );

    if (!schemaRows[0]?.exists) {
      return NextResponse.json({
        ok: true,
        phase: "PHASE_1",
        installed: false,
        subject: {
          tenantId: orgId,
          userId
        },
        message: "Phase 1 schema is not installed yet. Run the latest Prisma migration."
      });
    }

    const [
      tierRows,
      graphRows,
      guardRows,
      suffixRows,
      partitionRows
    ] = await Promise.all([
      prisma.$queryRawUnsafe<TierCountRow[]>(
        `
          SELECT
            COUNT(*) FILTER (WHERE tier = 'LONG_TERM'::dna_memory.memory_tier)::int AS "longTerm",
            COUNT(*) FILTER (WHERE tier = 'ARCHIVE'::dna_memory.memory_tier)::int AS "archive",
            COUNT(*) FILTER (WHERE tier = 'STAGING'::dna_memory.memory_tier)::int AS "staging",
            COUNT(*) FILTER (WHERE memory_domain = 'CONTEXTUAL'::dna_memory.memory_domain)::int AS "contextual",
            COUNT(*) FILTER (WHERE memory_domain = 'WORKING'::dna_memory.memory_domain)::int AS "working"
          FROM dna_memory.central_memory
          WHERE tenant_id = $1
            AND user_id = $2
        `,
        orgId,
        userId
      ),
      prisma.$queryRawUnsafe<GraphCountRow[]>(
        `
          SELECT
            (SELECT COUNT(*)::int FROM dna_memory.nodes WHERE tenant_id = $1 AND user_id = $2) AS "nodes",
            (SELECT COUNT(*)::int FROM dna_memory.edges WHERE tenant_id = $1 AND user_id = $2) AS "edges"
        `,
        orgId,
        userId
      ),
      prisma.$queryRawUnsafe<GuardRailRow[]>(`
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'dna_memory'
              AND c.relname = 'central_memory'
              AND c.relrowsecurity = TRUE
          ) AS "centralMemoryRls",
          EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'dna_memory'
              AND c.relname = 'nodes'
              AND c.relrowsecurity = TRUE
          ) AS "nodesRls",
          EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'dna_memory'
              AND c.relname = 'edges'
              AND c.relrowsecurity = TRUE
          ) AS "edgesRls",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'central_memory' AND column_name = 'version'
          ) AS "centralMemoryVersion",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'nodes' AND column_name = 'version'
          ) AS "nodesVersion",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'edges' AND column_name = 'version'
          ) AS "edgesVersion",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'central_memory' AND column_name = 'schema_version'
          ) AS "centralMemorySchemaVersion",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'nodes' AND column_name = 'schema_version'
          ) AS "nodesSchemaVersion",
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'dna_memory' AND table_name = 'edges' AND column_name = 'schema_version'
          ) AS "edgesSchemaVersion"
      `),
      prisma.$queryRawUnsafe<Array<{ suffix: string }>>(
        "SELECT dna_memory.partition_suffix($1, $2) AS suffix",
        orgId,
        userId
      ),
      prisma.$queryRawUnsafe<PartitionRow[]>(`
        SELECT
          parent.relname AS parent,
          child.relname AS child
        FROM pg_inherits rel
        JOIN pg_class parent ON parent.oid = rel.inhparent
        JOIN pg_class child ON child.oid = rel.inhrelid
        JOIN pg_namespace ns ON ns.oid = parent.relnamespace
        WHERE ns.nspname = 'dna_memory'
          AND parent.relname IN ('central_memory', 'nodes', 'edges')
        ORDER BY parent.relname ASC, child.relname ASC
      `)
    ]);

    const tier = tierRows[0] ?? {
      longTerm: 0,
      archive: 0,
      staging: 0,
      contextual: 0,
      working: 0
    };
    const graph = graphRows[0] ?? {
      nodes: 0,
      edges: 0
    };
    const guardRails = guardRows[0] ?? {
      centralMemoryRls: false,
      nodesRls: false,
      edgesRls: false,
      centralMemoryVersion: false,
      nodesVersion: false,
      edgesVersion: false,
      centralMemorySchemaVersion: false,
      nodesSchemaVersion: false,
      edgesSchemaVersion: false
    };

    const suffix = suffixRows[0]?.suffix ?? "";
    const expectedCentral = `central_memory_p_${suffix}`;
    const expectedNodes = `nodes_p_${suffix}`;
    const expectedEdges = `edges_p_${suffix}`;

    const children = new Set(partitionRows.map((row) => row.child));

    const partitionTotals = {
      centralMemory: partitionRows.filter((row) => row.parent === "central_memory").length,
      nodes: partitionRows.filter((row) => row.parent === "nodes").length,
      edges: partitionRows.filter((row) => row.parent === "edges").length
    };

    return NextResponse.json({
      ok: true,
      phase: "PHASE_1",
      installed: true,
      subject: {
        tenantId: orgId,
        userId
      },
      storage: {
        tierCounts: {
          longTerm: asNumber(tier.longTerm),
          archive: asNumber(tier.archive),
          staging: asNumber(tier.staging)
        },
        strandCounts: {
          contextual: asNumber(tier.contextual),
          working: asNumber(tier.working)
        },
        graph: {
          nodes: asNumber(graph.nodes),
          edges: asNumber(graph.edges)
        },
        partitions: {
          suffix,
          expected: {
            centralMemory: expectedCentral,
            nodes: expectedNodes,
            edges: expectedEdges
          },
          present: {
            centralMemory: children.has(expectedCentral),
            nodes: children.has(expectedNodes),
            edges: children.has(expectedEdges)
          },
          totals: partitionTotals,
          samples: partitionRows.slice(0, 18)
        },
        safeguards: {
          rls: {
            centralMemory: Boolean(guardRails.centralMemoryRls),
            nodes: Boolean(guardRails.nodesRls),
            edges: Boolean(guardRails.edgesRls)
          },
          occColumns: {
            centralMemory: Boolean(guardRails.centralMemoryVersion),
            nodes: Boolean(guardRails.nodesVersion),
            edges: Boolean(guardRails.edgesVersion)
          },
          schemaVersionColumns: {
            centralMemory: Boolean(guardRails.centralMemorySchemaVersion),
            nodes: Boolean(guardRails.nodesSchemaVersion),
            edges: Boolean(guardRails.edgesSchemaVersion)
          }
        }
      }
    });
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return NextResponse.json({
        ok: true,
        phase: "PHASE_1",
        installed: false,
        subject: {
          tenantId: orgId,
          userId
        },
        message: "Phase 1 schema is not installed yet. Run the latest Prisma migration."
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load Phase 1 memory status."
      },
      { status: 500 }
    );
  }
}
