import * as AgentPack from "../../../modules/auto-game-agent-pack/index.js";
import { type AutoGameProjectSkill, discoverAutoGameProjectSkills } from "../../../modules/auto-game-skills/index.js";
import type { GraphResolutionContext } from "../shared.js";

type AgentPackStatusWithResources = AgentPack.AgentPackProjectStatus & {
    resources: ReadonlyArray<AgentPack.AgentPackResourcePreview>;
};

type SkillWithId = AutoGameProjectSkill & { id: string };

type AutoGamePipelineModel = Readonly<{
    actions: ReadonlyArray<never>;
    agentPack: AgentPackStatusWithResources;
    events: ReadonlyArray<never>;
    llmOutputs: ReadonlyArray<never>;
    skills: ReadonlyArray<SkillWithId>;
    status: "idle";
    statusText: string;
}>;

function createAutoGamePipelineModel(
    skills: ReadonlyArray<AutoGameProjectSkill>,
    agentPackStatus: AgentPack.AgentPackProjectStatus,
    resources: ReadonlyArray<AgentPack.AgentPackResourcePreview>
): AutoGamePipelineModel {
    return Object.freeze({
        actions: Object.freeze<never[]>([]),
        agentPack: Object.freeze({ ...agentPackStatus, resources }),
        events: Object.freeze<never[]>([]),
        llmOutputs: Object.freeze<never[]>([]),
        skills: Object.freeze(skills.map((skill) => Object.freeze({ ...skill, id: skill.name }))),
        status: "idle",
        statusText:
            skills.length === 0
                ? "No project-scoped Auto-Game skills are installed."
                : `${String(skills.filter((skill) => skill.enabled).length)} of ${String(skills.length)} project skills included in Auto-Game.`
    });
}

async function createAutoGamePipelineModelForProject(context: GraphResolutionContext): Promise<AutoGamePipelineModel> {
    const [skills, agentPackStatus, resources] = await Promise.all([
        discoverAutoGameProjectSkills(context.projectRoot, context.projectConfig),
        AgentPack.readAgentPackProjectStatus(context.projectRoot),
        AgentPack.readAgentPackResourcePreviews()
    ]);
    return createAutoGamePipelineModel(skills, agentPackStatus, resources);
}

export { type AutoGamePipelineModel, createAutoGamePipelineModel, createAutoGamePipelineModelForProject };
