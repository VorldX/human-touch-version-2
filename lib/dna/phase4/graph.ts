import "server-only";

import { prisma } from "@/lib/db/prisma";
import { dnaPhase4Config } from "@/lib/dna/phase4/config";

interface GraphNodeRow {
  id: number;
  label: string;
  propertiesJsonb: unknown;
  version: number;
  updatedAt: Date;
}

interface GraphEdgeRow {
  id: number;
  sourceId: number;
  targetId: number;
  relationshipType: string;
  weight: number;
  version: number;
  updatedAt: Date;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function getKnowledgeGraphSnapshot(input: {
  tenantId: string;
  userId: string;
  nodeLimit?: number;
  edgeLimit?: number;
}) {
  const nodeLimit = clamp(
    input.nodeLimit ?? dnaPhase4Config.graph.defaultNodeLimit,
    20,
    1200
  );
  const edgeLimit = clamp(
    input.edgeLimit ?? dnaPhase4Config.graph.defaultEdgeLimit,
    20,
    2400
  );

  const [nodes, edges] = await Promise.all([
    prisma.$queryRawUnsafe<GraphNodeRow[]>(
      `
        SELECT
          id,
          label,
          properties_jsonb AS "propertiesJsonb",
          version,
          updated_at AS "updatedAt"
        FROM dna_memory.nodes
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY updated_at DESC
        LIMIT $3
      `,
      input.tenantId,
      input.userId,
      nodeLimit
    ),
    prisma.$queryRawUnsafe<GraphEdgeRow[]>(
      `
        SELECT
          id,
          source_id AS "sourceId",
          target_id AS "targetId",
          relationship_type AS "relationshipType",
          weight,
          version,
          updated_at AS "updatedAt"
        FROM dna_memory.edges
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY weight DESC, updated_at DESC
        LIMIT $3
      `,
      input.tenantId,
      input.userId,
      edgeLimit
    )
  ]);

  const allowedNodeIds = new Set(nodes.map((node) => node.id));
  const filteredEdges = edges.filter(
    (edge) => allowedNodeIds.has(edge.sourceId) && allowedNodeIds.has(edge.targetId)
  );

  return {
    nodes,
    edges: filteredEdges
  };
}
