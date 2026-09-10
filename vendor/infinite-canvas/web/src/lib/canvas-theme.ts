export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#eef1ec",
            dot: "rgba(23,48,45,.16)",
            line: "rgba(23,48,45,.08)",
            selectionStroke: "#e0a21a",
            selectionFill: "rgba(224,162,26,.10)",
        },
        node: {
            label: "#5b6d68",
            fill: "#e8ede8",
            panel: "#ffffff",
            stroke: "#d5dcd5",
            activeStroke: "#e0a21a",
            placeholder: "#6f7f78",
            text: "#17302d",
            muted: "#5b6d68",
            faint: "#7c8d84",
        },
        toolbar: {
            panel: "rgba(255,255,255,.97)",
            border: "#d5dcd5",
            item: "#5b6d68",
            itemHover: "#e8ede8",
            activeBg: "#fbf0d6",
            activeText: "#855600",
        },
    },
    dark: {
        canvas: {
            background: "#0d0d0d",
            dot: "rgba(255,255,255,.12)",
            line: "rgba(255,255,255,.07)",
            selectionStroke: "#65bdff",
            selectionFill: "rgba(101,189,255,.08)",
        },
        node: {
            label: "#b8b8bf",
            fill: "#242424",
            panel: "#1a1a1a",
            stroke: "#36363a",
            activeStroke: "#65bdff",
            placeholder: "#99999f",
            text: "#f4f4f5",
            muted: "#a4a4ab",
            faint: "#828289",
        },
        toolbar: {
            panel: "rgba(30,30,30,.96)",
            border: "#ffffff14",
            item: "#b8b8bf",
            itemHover: "#2b2b2e",
            activeBg: "#193347",
            activeText: "#d9efff",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
