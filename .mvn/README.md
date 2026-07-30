# .mvn

`jvm.config` is read by Maven itself and applied to the JVM every `mvn` invocation runs in.

The flags are there for the openmrs-packager plugin's `validate-configurations` goal, which
boots a Spring context in-process to run Initializer against a throwaway MySQL. Two things
in that context predate the module system:

- Spring generates proxies through `ClassLoader.defineClass`. From Java 16 onward the JDK
  refuses that reflective access unless `java.base/java.lang` is opened, and the goal dies
  with `InaccessibleObjectException` before it validates a single CSV — which reads as a
  content error rather than a JVM one.
- OpenMRS's `SimpleXStreamSerializer` constructs an XStream, whose `FontConverter`
  statically reflects over `java.awt.font.TextAttribute`. Hence the `java.desktop` open and
  headless mode; a build has no display to fall back on.

Remove these once the packager plugin no longer needs them. They are not a project
preference; they are a workaround with an expiry date.
