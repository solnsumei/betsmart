import { NextResponse } from "next/server";
import { db } from "@/db";
import { crawlTargets } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const targets = await db
      .select()
      .from(crawlTargets)
      .orderBy(desc(crawlTargets.createdAt));
    return NextResponse.json({ success: true, targets });
  } catch (error: any) {
    console.error("[API] Failed to fetch crawl targets:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, name, url, enabled } = body;

    if (id) {
      // Update existing target (e.g. status toggle or edit)
      const [updated] = await db
        .update(crawlTargets)
        .set({
          name: name !== undefined ? name : undefined,
          url: url !== undefined ? url : undefined,
          enabled: enabled !== undefined ? enabled : undefined,
        })
        .where(eq(crawlTargets.id, id))
        .returning();
      return NextResponse.json({ success: true, target: updated });
    } else {
      // Insert new target
      if (!name || !url) {
        return NextResponse.json({ error: "Name and URL are required." }, { status: 400 });
      }
      const [inserted] = await db
        .insert(crawlTargets)
        .values({
          name,
          url,
          enabled: enabled !== undefined ? enabled : true,
        })
        .returning();
      return NextResponse.json({ success: true, target: inserted });
    }
  } catch (error: any) {
    console.error("[API] Failed to save crawl target:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get("id");
    if (!idStr) {
      return NextResponse.json({ error: "Missing crawl target id parameter." }, { status: 400 });
    }
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid id parameter." }, { status: 400 });
    }

    await db.delete(crawlTargets).where(eq(crawlTargets.id, id));
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error("[API] Failed to delete crawl target:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
