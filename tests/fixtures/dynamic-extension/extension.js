const vscode = require("vscode");

/** Set the view's `when` context; the commands are the gate's control surface. */
function activate(context) {
  const set = async (visible) => {
    await vscode.commands.executeCommand("setContext", "pracGateVisible", visible);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("prac.gate.show", () => set(true)),
    vscode.commands.registerCommand("prac.gate.hide", () => set(false)),
  );
}

exports.activate = activate;
