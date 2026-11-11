import { describe, expect, it } from "vitest";
import { createRnacentralApiFetch } from "./api-adapter";

// License audit 2026-11-10: RNAcentral is CC0. Sci-ModoM states no data license, so
// its routes are withheld from a reselling caller.
describe("RNAcentral adapter under the commercial license profile", () => {
	const apiFetch = createRnacentralApiFetch();

	it("refuses the Sci-ModoM routes with HTTP 451 and makes no upstream request", async () => {
		for (const path of ["/scimodom/modification", "/scimodom"]) {
			const result = await apiFetch({ method: "GET", path, licenseProfile: "commercial" });
			expect(`${path}:${result.status}`).toBe(`${path}:451`);
			expect(result.data).toMatchObject({ error: "NOT_LICENSED_FOR_COMMERCIAL_USE" });
		}
	});
});
