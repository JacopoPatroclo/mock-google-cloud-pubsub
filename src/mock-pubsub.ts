import type {
  PubSub as RealPubSub,
  Subscription,
  Topic,
  CreateSubscriptionResponse,
  GetTopicsResponse,
  GetSubscriptionsResponse,
  CreateTopicResponse,
  Message,
} from '@google-cloud/pubsub';
import {
  delay,
  libError,
  makeTopicName,
  makeSubscriptionName,
  nonExisitingTopic,
  nonExisitingSubscription,
  emptyResponse,
  makeSequentialNumberString,
} from './utils';
import { createMessage } from './message';
import { createSubscription, type MockSubscription } from './subscription';

const topics: Record<string, Topic> = {};
const subscriptions: Record<string, MockSubscription> = {};

function getSubscription(
  projectId: string,
  subscriptionName: string,
): Subscription {
  const name = makeSubscriptionName({ projectId, subscriptionName });
  return subscriptions[name] || nonExisitingSubscription;
}

// @ts-expect-error partial PubSub implementation
class PubSub implements RealPubSub {
  projectId: string;
  interceptMessage: (msg: Message) => Message;

  constructor(
    { projectId = '{{projectId}}' } = {},
    { interceptMessage = (msg: Message) => msg } = {},
  ) {
    this.projectId = projectId;
    this.interceptMessage = interceptMessage;
  }

  async getTopics() {
    const projectTopics = Object.values(topics).filter((topic) =>
      topic.name.startsWith(`projects/${this.projectId}/`),
    );

    const response: GetTopicsResponse = [projectTopics];
    return response;
  }

  async getSubscriptions() {
    const projectSubscriptions = Object.values(subscriptions).filter(
      (subscription) =>
        subscription.name.startsWith(`projects/${this.projectId}/`),
    );
    const response: GetSubscriptionsResponse = [projectSubscriptions];
    return response;
  }

  async createTopic(topicName: string) {
    const name = makeTopicName({ projectId: this.projectId, topicName });
    if (topics[name]) {
      throw libError(6, 'ALREADY_EXISTS: Topic already exists');
    }
    const topic = createTopic({
      projectId: this.projectId,
      name,
      interceptMessage: this.interceptMessage,
    });
    topics[name] = topic;

    const response: CreateTopicResponse = [topic, {}];
    return response;
  }

  topic(topicName: string) {
    const name = makeTopicName({ projectId: this.projectId, topicName });
    return topics[name] || nonExisitingTopic;
  }

  subscription(subscriptionName: string) {
    return getSubscription(this.projectId, subscriptionName);
  }
}

function createTopic(opts: {
  projectId: string;
  name: string;
  interceptMessage: (message: Message) => Message;
}): Topic {
  const topicSubscriptionNames: string[] = [];

  // @ts-expect-error partial Topic implementation
  const topic: Topic = {
    name: opts.name,
    async delete() {
      delete topics[opts.name];
      return emptyResponse;
    },
    async createSubscription(subscriptionName: string, options: object) {
      const name = makeSubscriptionName({
        projectId: opts.projectId,
        subscriptionName,
      });
      if (subscriptions[name]) {
        throw libError(6, 'ALREADY_EXISTS: Subscription already exists');
      }

      const subscription = createSubscription({
        name,
        onDelete: () => {
          delete subscriptions[name];
        },
      });
      subscriptions[name] = subscription;
      topicSubscriptionNames.push(name);

      const response: CreateSubscriptionResponse = [subscription, {}];
      return response;
    },
    async publish(data, attributes) {
      await delay(5);
      const messageId = makeSequentialNumberString();
      topicSubscriptionNames.forEach((name) => {
        const subscription = subscriptions[name];
        if (subscription) {
          const message = createMessage({
            id: messageId,
            subscription: subscription,
            dataInput: data,
            // Currently not supporting callback api
            attributes:
              typeof attributes === 'function' ? undefined : attributes,
          });

          subscription._queueMessage(opts.interceptMessage(message));
        }
      });

      return messageId;
    },
    async publishMessage(messageOptions) {
      await delay(5);
      const messageId = makeSequentialNumberString();
      const data = messageOptions.json
        ? JSON.stringify(messageOptions.json)
        : messageOptions.data;
      const attributes = messageOptions.attributes ?? undefined;

      topicSubscriptionNames.forEach((name) => {
        const subscription = subscriptions[name];
        if (subscription) {
          const message = createMessage({
            id: messageId,
            subscription: subscription,
            dataInput: data,
            attributes,
          });
          subscription._queueMessage(opts.interceptMessage(message));
        }
      });

      return messageId;
    },
    setPublishOptions() {},
    subscription(subscriptionName: string) {
      return getSubscription(opts.projectId, subscriptionName);
    },
  };

  return topic;
}

export { PubSub };
