import { expect, it } from "vitest";
import { läsProcessLänk, processLänk } from "./lank";

it("länken bär processens id, och läses tillbaka till samma id", () => {
  expect(processLänk("ap-begaran-om-mejllogg")).toBe("#/process/ap-begaran-om-mejllogg");
  expect(läsProcessLänk("#/process/ap-begaran-om-mejllogg")).toBe("ap-begaran-om-mejllogg");
  const udda = "flöde med å/ä?";
  expect(läsProcessLänk(processLänk(udda))).toBe(udda);
});

it("ingen process ger ingen adress, och en främmande adress ingen process", () => {
  expect(processLänk(null)).toBe("");
  expect(läsProcessLänk("")).toBeNull();
  expect(läsProcessLänk("#/process/")).toBeNull();
  expect(läsProcessLänk("#nagot-annat")).toBeNull();
  expect(läsProcessLänk("#/process/%E0%A4%A")).toBeNull(); // trasig kodning
});
