import FeatureSection from '../FeatureSection';
import aiChatImage from '@assets/generated_images/AI_chat_feature_showcase_4b227a38.png';

export default function FeatureSectionExample() {
  return (
    <FeatureSection
      title="Intelligent AI Assistant"
      description="Talk to Milo in plain English. No complex interfaces or training required."
      image={aiChatImage}
      imageAlt="Milo AI chat interface"
      features={[
        "Natural language scheduling commands",
        "Real-time driver availability queries",
        "Automatic conflict detection and resolution",
        "Smart recommendations for optimal assignments"
      ]}
    />
  );
}
