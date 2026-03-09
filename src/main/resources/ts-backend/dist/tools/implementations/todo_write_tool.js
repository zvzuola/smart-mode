/**
 * TodoWrite 工具 - 创建和管理结构化任务列表
 */
import { randomBytes } from "node:crypto";
export class TodoWriteTool {
    name = "TodoWrite";
    description = "Create and manage a structured task list for your current coding session";
    get_definition() {
        return {
            name: this.name,
            description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: I'll help add a dark mode toggle to your application settings. Let me create a todo list to track this implementation.
*Creates todo list with the following items:*
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: Let me first search through your codebase to find all occurrences of 'getCwd'.
*Uses grep or search tools to locate all instances of getCwd in the codebase*
Assistant: I've found 15 instances of 'getCwd' across 8 different files. Let me create a todo list to track these changes.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. First, the assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains code consistency
</reasoning>
</example>

<example>
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: I'll help implement these features. First, let's add all the features to the todo list.
*Creates a todo list breaking down each feature into specific tasks based on the project architecture*
Assistant: Let's start with user registration. This will involve creating database models, API endpoints, and frontend forms that integrate with your existing authentication system.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple complex features to implement in a comma separated list
2. The todo list helps organize these large features into manageable tasks
3. This approach allows for tracking progress across the entire implementation
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:
print("Hello World")
This will output the text "Hello World" to the console when executed.

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area. It displays which changes have been staged, which haven't, and which files aren't being tracked by Git. This is a fundamental command for understanding the current state of your repository before making commits.

<reasoning>
The assistant did not use the todo list because this is an informational request with no actual coding task to complete. The user is simply asking for an explanation, not for the assistant to perform multiple steps or tasks.
</reasoning>
</example>

<example>
User: Can you add a comment to the calculateTotal function to explain what it does?
Assistant: Sure, let me add a comment to the calculateTotal function to explain what it does.
* Uses the Edit tool to add a comment to the calculateTotal function *

<reasoning>
The assistant did not use the todo list because this is a single, straightforward task confined to one location in the code. Adding a comment doesn't require tracking multiple steps or systematic organization.
</reasoning>
</example>

<example>
User: Run npm install for me and tell me what happens.
Assistant: I'll run the npm install command for you.
*Executes: npm install*
The command completed successfully. Here's the output:
[Output of npm install command]
All dependencies have been installed according to your package.json file.

<reasoning>
The assistant did not use the todo list because this is a single command execution with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward task.
</reasoning>
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,
            input_schema: {
                type: "object",
                properties: {
                    todos: {
                        type: "array",
                        description: "The updated todo list",
                        items: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Unique identifier for the todo item",
                                },
                                content: {
                                    type: "string",
                                    description: "The imperative form describing what needs to be done",
                                },
                                status: {
                                    type: "string",
                                    enum: ["pending", "in_progress", "completed"],
                                    description: "Current status of the todo item",
                                },
                            },
                            required: ["id", "content", "status"],
                        },
                    },
                },
                required: ["todos"],
            },
        };
    }
    generateTodoId() {
        const randomPart = randomBytes(4).toString("hex");
        return `todo_${randomPart}`;
    }
    validateTodoItem(todo) {
        if (typeof todo !== "object" || todo === null) {
            return false;
        }
        const item = todo;
        // content 必须存在且为非空字符串
        if (typeof item.content !== "string" || item.content.trim() === "") {
            return false;
        }
        // status 必须是有效值
        if (!["pending", "in_progress", "completed"].includes(item.status)) {
            return false;
        }
        return true;
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { todos } = input.arguments;
        try {
            // 参数验证
            if (!Array.isArray(todos)) {
                throw new Error("todos must be an array");
            }
            if (todos.length === 0) {
                throw new Error("todos array cannot be empty");
            }
            // 处理每个 todo 项
            const processedTodos = [];
            for (const todo of todos) {
                if (!this.validateTodoItem(todo)) {
                    throw new Error("Invalid todo item: missing or invalid content/status field");
                }
                const item = todo;
                // 如果没有 id，生成一个新的
                const todoItem = {
                    id: item.id || this.generateTodoId(),
                    content: item.content.trim(),
                    status: item.status,
                };
                processedTodos.push(todoItem);
            }
            // 统计不同状态的任务数量
            const stats = {
                pending: 0,
                in_progress: 0,
                completed: 0,
            };
            for (const todo of processedTodos) {
                stats[todo.status]++;
            }
            const totalCount = processedTodos.length;
            const summary = `Updated todo list with ${totalCount} tasks (completed: ${stats.completed}, in_progress: ${stats.in_progress}, pending: ${stats.pending})`;
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: true,
                    todos: processedTodos,
                    merge: false,
                    count: totalCount,
                    summary,
                    stats,
                },
                result_for_assistant: summary,
                is_error: false,
                duration_ms: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    error: error instanceof Error ? error.message : String(error),
                },
                result_for_assistant: `Failed to update todo list: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return true; // TodoWrite 不修改文件系统，是并发安全的
    }
    is_readonly() {
        return true; // TodoWrite 不修改用户文件，只记录任务状态
    }
    needs_permissions(_input) {
        return false; // TodoWrite不需要文件系统权限
    }
}
//# sourceMappingURL=todo_write_tool.js.map