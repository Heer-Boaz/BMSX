import { BehaviorTreeDefinition, WaitForActionCompletionDecorator } from 'bmsx';
import { bclass } from './bclass';

export function mytree_builder(): BehaviorTreeDefinition {
	return {
		type: 'Selector',
		children: [
			{
				type: 'Sequence',
				children: [
					{ type: 'Condition', condition: () => Math.random() > .9 },
					{
						type: 'Action', action: function (this: bclass, _blackboard) {
							console.log(`Action 1 executed for ${this.id}`)
							return 'SUCCESS';
						}
					}
				]
			},
			{
				type: 'Sequence',
				children: [
					{ type: 'Wait', wait_time: 50, wait_propname: 'waiting' },
					{
						type: 'Decorator', decorator: WaitForActionCompletionDecorator,
						child: {
							type: 'Action', action: function (this: bclass, blackboard) {
								console.log(`Sequence action after waiting for ${this.id}`);
								let testieblap = blackboard.get<number>('testdieblap') ?? 0;
								let success = false;
								if (++testieblap > 3) {
									testieblap = 0;
									success = true;
								}
								blackboard.set<number>('testdieblap', testieblap);
								return success ? 'SUCCESS' : 'RUNNING';
							}
						}
					},
					{
						type: 'Action',
						action: function (this: bclass, _blackboard) {
							console.log(`Sequence action after decorated action for ${this.id}`);
							return 'SUCCESS';
						}
					},
				]
			},
			{
				type: 'Limit',
				limit: 3,
				count_propname: 'counting',
				child: {
					type: 'Action',
					action: function (this: bclass, _blackboard) {
						console.log(`Limited action for ${this.id}`);
						return 'SUCCESS';
					}
				}
			},
			{
				type: 'RandomSelector',
				children: [
					{
						type: 'Action', action: function (this: bclass, _blackboard) {
							console.log(`Random action A for ${this.id}`)
							return 'SUCCESS';
						}
					},
					{
						type: 'Action', action: function (this: bclass, _blackboard) {
							console.log(`Random action B for ${this.id}`)
							return 'SUCCESS';
						}
					}
				],
				currentchild_propname: 'randomchild'
			},
			{
				type: 'Action',
				action: function (this: bclass, _blackboard) {
					console.log(`Fallback action executed for ${this.id}`)
					return 'SUCCESS';
				}
			}
		]
	};
}
