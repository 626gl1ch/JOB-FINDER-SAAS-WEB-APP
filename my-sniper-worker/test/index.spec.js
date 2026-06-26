import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src";

describe("SnipeJob worker", () => {
    beforeEach(() => {
        env.SUPABASE_URL = "https://example.supabase.co";
        env.SUPABASE_ANON_KEY = "anon-key";
        env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
        env.GEMINI_API_KEY = "gemini-key";
    });

	it("responds with 503 when env vars are missing", async () => {
        delete env.SUPABASE_URL;

		const request = new Request("http://example.com");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(503);
        const data = await response.json();
        expect(data.error).toBe("Worker misconfigured: missing environment variables");
	});

    it("handles preflight OPTIONS request with CORS headers", async () => {
        const request = new Request("http://localhost", { method: "OPTIONS" });
        request.headers.set("Origin", "http://localhost");
        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env, ctx);
        expect(response.status).toBe(204);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
    });

    it("returns CORS headers on 404 (non-existent route)", async () => {
        const request = new Request("http://localhost/non-existent", { method: "GET" });
        request.headers.set("Origin", "http://localhost");
        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env, ctx);
        expect(response.status).toBe(404);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
    });
});
