import { DefaultWidget, makeWidget, type Widget } from "./model.js";
import { parseLabel } from "./helper.js";

export const primary: Widget = makeWidget(parseLabel("primary"));
export const secondary = new DefaultWidget("secondary");
