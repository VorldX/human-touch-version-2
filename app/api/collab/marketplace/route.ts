import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { computeDynamicAgentPrice } from "@/lib/enterprise/passive";

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

  const personnel = await prisma.personnel.findMany({
    where: { orgId },
    orderBy: [{ isRented: "desc" }, { autonomyScore: "desc" }, { updatedAt: "desc" }]
  });

  const mapped = personnel.map((member) => {
    const baseRate =
      Number(member.rentRate ?? 0) ||
      Number(member.cost ?? 0) ||
      Number(member.salary ?? 0) / 160 ||
      0;

    const dynamicRate = computeDynamicAgentPrice({
      baseRate,
      autonomyScore: member.autonomyScore,
      pricingModel: member.pricingModel
    });

    return {
      id: member.id,
      type: member.type,
      name: member.name,
      role: member.role,
      status: member.status,
      isRented: member.isRented,
      pricingModel: member.pricingModel,
      autonomyScore: member.autonomyScore,
      baseRate,
      dynamicRate,
      rentRate: Number(member.rentRate ?? 0),
      assignedOAuthIds: member.assignedOAuthIds
    };
  });

  const listedAssets = mapped.filter((entry) => !entry.isRented);
  const rentedAssets = mapped.filter((entry) => entry.isRented);

  const listedRate = listedAssets.reduce((total, entry) => total + entry.dynamicRate, 0);
  const rentedRate = rentedAssets.reduce((total, entry) => total + entry.dynamicRate, 0);
  const contractYieldPerHour = Number((listedRate - rentedRate * 0.35).toFixed(4));

  return NextResponse.json({
    ok: true,
    listedAssets,
    rentedAssets,
    metrics: {
      listedCount: listedAssets.length,
      rentedCount: rentedAssets.length,
      averageAutonomy:
        mapped.length > 0
          ? Number((mapped.reduce((acc, item) => acc + item.autonomyScore, 0) / mapped.length).toFixed(3))
          : 0,
      contractYieldPerHour
    }
  });
}

