import { describe, it, expect } from "vitest";
import { buildClusters, clusterStudents } from "./clusters";
import type { PairwiseResult } from "./types";

describe("buildClusters", () => {
  it("should return empty array if no flagged results", () => {
    const results: PairwiseResult[] = [
      {
        student_a_id: "1",
        student_b_id: "2",
        student_a_name: "A",
        student_b_name: "B",
        student_a_file: "a.txt",
        student_b_file: "b.txt",
        fingerprint_score: 50,
        semantic_score: 50,
        combined_score: 50,
        flagged: false,
        is_identical_file: false,
        matched_fragments: [],
      }
    ];
    expect(buildClusters(results)).toEqual([]);
  });

  it("should group connected flagged pairs", () => {
    const results: PairwiseResult[] = [
      {
        student_a_id: "1", student_b_id: "2",
        student_a_name: "A", student_b_name: "B",
        student_a_file: "a.txt", student_b_file: "b.txt",
        fingerprint_score: 90, semantic_score: 90, combined_score: 90,
        flagged: true, is_identical_file: false, matched_fragments: []
      },
      {
        student_a_id: "2", student_b_id: "3",
        student_a_name: "B", student_b_name: "C",
        student_a_file: "b.txt", student_b_file: "c.txt",
        fingerprint_score: 90, semantic_score: 90, combined_score: 85,
        flagged: true, is_identical_file: false, matched_fragments: []
      },
      {
        student_a_id: "4", student_b_id: "5",
        student_a_name: "D", student_b_name: "E",
        student_a_file: "d.txt", student_b_file: "e.txt",
        fingerprint_score: 90, semantic_score: 90, combined_score: 95,
        flagged: true, is_identical_file: false, matched_fragments: []
      }
    ];

    const clusters = buildClusters(results);
    expect(clusters.length).toBe(2);
    
    // Sort logic should put highest max score first (95 > 90)
    expect(clusters[0].length).toBe(1); // 4-5
    expect(clusters[1].length).toBe(2); // 1-2, 2-3
  });
});

describe("clusterStudents", () => {
  it("should extract unique sorted student names", () => {
    const cluster: PairwiseResult[] = [
      {
        student_a_id: "2", student_b_id: "3",
        student_a_name: "Bob", student_b_name: "Charlie",
        student_a_file: "", student_b_file: "",
        fingerprint_score: 90, semantic_score: 90, combined_score: 85,
        flagged: true, is_identical_file: false, matched_fragments: []
      },
      {
        student_a_id: "1", student_b_id: "2",
        student_a_name: "Alice", student_b_name: "Bob",
        student_a_file: "", student_b_file: "",
        fingerprint_score: 90, semantic_score: 90, combined_score: 85,
        flagged: true, is_identical_file: false, matched_fragments: []
      }
    ];
    const names = clusterStudents(cluster);
    expect(names).toEqual(["Alice", "Bob", "Charlie"]);
  });
});
